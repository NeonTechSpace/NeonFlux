import { describe, expect, it } from 'vitest';

import {
    createBlueprintDecisionLedgerDigest,
    createBlueprintPlanAuthority,
    createBlueprintPlanCreationRequestKey,
    createBlueprintPlanDigest,
    createBlueprintPlanIntegrityDigests,
    createBlueprintPreflightEvidenceDigests,
    createBlueprintRunVerificationEvidenceDigest,
    createBlueprintRestorePointSnapshotDigest,
    createBlueprintRunTerminalDigest,
    createBlueprintRunTerminalRequestDigest,
    createBlueprintStepLedgerDigest,
    deriveBlueprintPlanExecutionAuthority,
    deriveBlueprintPlanExecutionAuthorityBody,
    sha256CanonicalJson,
    validateBlueprintDecisionLedgerIntegrity,
    validateBlueprintPlanAuthorityIntegrity,
    validateBlueprintPlanExecutionAuthorityIntegrity,
    validateBlueprintPlanMetadataIntegrity,
    validateBlueprintPreflightEvidenceIntegrity,
    validateBlueprintRunVerificationEvidenceIntegrity,
    validateBlueprintStepLedgerIntegrity,
} from './integrity.js';
import { createBlueprintMutationFenceManifest } from './mutation-fence.js';
import {
    createBlueprintPlanExecutionAuthorityPersistence,
    getBlueprintPlanExecutionAuthorityBucket,
    validateBlueprintPlanExecutionAuthorityPersistence,
} from './execution-authority.js';
import {
    normalizeBlueprintPlanStepLedger,
    type BlueprintPlanAuthorityBodyV1,
    type BlueprintPlanDecisionLedgerEntryV1,
    type BlueprintPlanStepLedgerEntryV1,
} from './persisted-authority.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from './protocol.js';

const timestamp = '2026-07-15T12:00:00.000Z';
const snapshot = {
    version: 1 as const,
    guildId: 'source-guild',
    roles: [],
    categories: [],
    channels: [],
};

function authorityBody(): BlueprintPlanAuthorityBodyV1 {
    return {
        requestedSnapshot: snapshot,
        projectedSnapshot: { ...snapshot, guildId: 'target-guild' },
        roleProjection: {
            version: 2,
            mode: 'synchronize',
            roles: [],
            skippedProtectedSourceIds: [],
            retainedProtectedTargetIds: [],
        },
        mappings: { roles: {}, categories: {}, channels: {} },
        referenceAuthority: {
            sourceTargetMap: { 'source-role': 'target-role', 'new-channel': null },
            knownTargetKinds: { 'target-guild': 'role', 'target-role': 'role' },
        },
        blockers: [],
        provenance: {
            source: 'dashboard-json',
            requestedGuildId: 'source-guild',
            requestedExportedAt: null,
            requestedSnapshotStoredAt: timestamp,
        },
    };
}

const steps: BlueprintPlanStepLedgerEntryV1[] = [
    {
        sequence: 0,
        step: {
            actionType: 'delete',
            targetType: 'role',
            targetId: 'target-role',
            label: 'Delete role',
            details: {
                label: 'Delete role',
                before: {
                    id: 'target-role',
                    name: 'Role',
                    position: 1,
                    color: 0,
                    permissions: '0',
                    hoist: false,
                    mentionable: false,
                },
            },
        },
    },
];

const decisions: BlueprintPlanDecisionLedgerEntryV1[] = [
    {
        sequence: 0,
        decision: {
            targetType: 'role',
            classification: 'delete',
            reason: 'target-unmatched-delete',
            targetId: 'target-role',
        },
    },
];

describe('Blueprint v4 integrity contracts', () => {
    it('creates and verifies separately linked full and execution authorities', async () => {
        const authority = await createBlueprintPlanAuthority({
            planId: 'plan-1',
            guildId: 'target-guild',
            body: authorityBody(),
            createdAt: timestamp,
        });
        const execution = await deriveBlueprintPlanExecutionAuthority({
            planId: 'plan-1',
            guildId: 'target-guild',
            authority,
            createdAt: timestamp,
        });

        expect(execution.sourceGuildId).toBe('source-guild');
        expect(execution.initialIdMap).toEqual({ 'source-role': 'target-role' });
        await expect(validateBlueprintPlanAuthorityIntegrity(authority)).resolves.toMatchObject({ type: 'valid' });
        await expect(
            validateBlueprintPlanExecutionAuthorityIntegrity({ executionAuthority: execution, authority })
        ).resolves.toMatchObject({ type: 'valid' });

        await expect(
            validateBlueprintPlanAuthorityIntegrity({ ...authority, blockers: [{ unexpected: true }] })
        ).resolves.toMatchObject({ type: 'invalid' });
        await expect(
            validateBlueprintPlanExecutionAuthorityIntegrity({
                executionAuthority: { ...execution, initialIdMap: {} },
                authority,
            })
        ).resolves.toMatchObject({ type: 'invalid' });
    });

    it('does not invent a source guild when the requested snapshot omits one', () => {
        const body = authorityBody();
        const { guildId: _guildId, ...requestedSnapshot } = body.requestedSnapshot;
        void _guildId;
        body.requestedSnapshot = requestedSnapshot;
        body.provenance = { ...body.provenance, requestedGuildId: null };
        expect(deriveBlueprintPlanExecutionAuthorityBody(body)).not.toHaveProperty('sourceGuildId');
    });

    it('persists execution authority as 64 deterministic integrity-bound buckets', async () => {
        const body = deriveBlueprintPlanExecutionAuthorityBody(authorityBody());
        const persisted = await createBlueprintPlanExecutionAuthorityPersistence({
            planId: 'plan-1',
            guildId: 'target-guild',
            authority: body,
            createdAt: timestamp,
        });
        expect(persisted.buckets).toHaveLength(64);
        expect(persisted.buckets.map(({ bucket }) => bucket)).toEqual(Array.from({ length: 64 }, (_, index) => index));
        await expect(
            validateBlueprintPlanExecutionAuthorityPersistence({
                manifest: persisted.manifest,
                buckets: persisted.buckets,
            })
        ).resolves.toMatchObject({ type: 'valid', value: { sourceTargetMap: body.sourceTargetMap } });
        await expect(getBlueprintPlanExecutionAuthorityBucket('new-channel')).resolves.toBe(
            await getBlueprintPlanExecutionAuthorityBucket('new-channel')
        );
        await expect(
            validateBlueprintPlanExecutionAuthorityPersistence({
                manifest: persisted.manifest,
                buckets: persisted.buckets.slice(1),
            })
        ).resolves.toMatchObject({ type: 'invalid' });
        await expect(
            validateBlueprintPlanExecutionAuthorityPersistence({
                manifest: persisted.manifest,
                buckets: persisted.buckets.map((bucket, index) =>
                    index === 0 ? { ...bucket, bucketDigest: '0'.repeat(64) } : bucket
                ),
            })
        ).resolves.toMatchObject({ type: 'invalid' });
        const sourceBucket = await getBlueprintPlanExecutionAuthorityBucket('new-channel');
        const wrongBucket = (sourceBucket + 1) % 64;
        await expect(
            validateBlueprintPlanExecutionAuthorityPersistence({
                manifest: persisted.manifest,
                buckets: persisted.buckets.map((bucket) =>
                    bucket.bucket === wrongBucket
                        ? { ...bucket, sourceTargetMap: { ...bucket.sourceTargetMap, 'new-channel': null } }
                        : bucket
                ),
            })
        ).resolves.toMatchObject({ type: 'invalid' });
    });

    it('binds ordered step and decision ledgers and rejects sequence/content tampering', async () => {
        const stepDigest = await createBlueprintStepLedgerDigest(steps);
        const decisionDigest = await createBlueprintDecisionLedgerDigest(decisions);
        const decision = decisions[0];
        if (!decision) throw new Error('Expected a decision fixture.');

        await expect(validateBlueprintStepLedgerIntegrity(steps, stepDigest)).resolves.toMatchObject({
            type: 'valid',
        });
        await expect(validateBlueprintDecisionLedgerIntegrity(decisions, decisionDigest)).resolves.toMatchObject({
            type: 'valid',
        });
        await expect(
            validateBlueprintStepLedgerIntegrity([{ ...steps[0], sequence: 1 }], stepDigest)
        ).resolves.toMatchObject({ type: 'invalid' });
        await expect(
            validateBlueprintDecisionLedgerIntegrity(
                [{ sequence: 0, decision: { ...decision.decision, reason: 'matched-equal' } }],
                decisionDigest
            )
        ).resolves.toMatchObject({ type: 'invalid' });
    });

    it('normalizes persisted step rows by taking the label from details', () => {
        const [entry] = steps;
        if (!entry) throw new Error('missing-test-step');
        expect(
            normalizeBlueprintPlanStepLedger([
                {
                    sequence: entry.sequence,
                    actionType: entry.step.actionType,
                    targetType: entry.step.targetType,
                    targetId: entry.step.targetId,
                    details: entry.step.details,
                },
            ])
        ).toEqual({ type: 'valid', value: steps });
    });

    it('creates a component digest bundle without requiring a database plan id', async () => {
        const authority = authorityBody();
        const executionAuthority = deriveBlueprintPlanExecutionAuthorityBody(authority);
        const summary = { creates: 0, updates: 0, deletes: 1, roles: 1, categories: 0, channels: 0 };
        const digests = await createBlueprintPlanIntegrityDigests({
            guildId: 'target-guild',
            policy: 'synchronize',
            summary,
            authority,
            executionAuthority,
            steps,
            decisions,
        });

        expect(digests).toMatchObject({ stepCount: 1, decisionCount: 1, deleteStepCount: 1 });
        expect(digests.deleteSetDigest).toHaveLength(64);
        expect(digests.planDigest).toHaveLength(64);
        const directDigestInput = {
            guildId: 'target-guild',
            policy: 'synchronize' as const,
            summary: digests.summary,
            decisionSummary: digests.decisionSummary,
            blockerCount: digests.blockerCount,
            requestedSnapshotDigest: digests.requestedSnapshotDigest,
            projectedSnapshotDigest: digests.projectedSnapshotDigest,
            authorityDigest: digests.authorityDigest,
            executionAuthorityDigest: digests.executionAuthorityDigest,
            stepLedger: { count: digests.stepCount, digest: digests.stepLedgerDigest },
            decisionLedger: { count: digests.decisionCount, digest: digests.decisionLedgerDigest },
            deleteLedger: { count: digests.deleteStepCount, digest: digests.deleteSetDigest },
        };
        await expect(createBlueprintPlanDigest(directDigestInput)).resolves.toBe(digests.planDigest);
        await expect(
            createBlueprintPlanDigest({ ...directDigestInput, requestedSnapshotDigest: '0'.repeat(64) })
        ).resolves.not.toBe(digests.planDigest);
        await expect(
            createBlueprintPlanDigest({
                ...directDigestInput,
                summary: { ...directDigestInput.summary, creates: directDigestInput.summary.creates + 1 },
            })
        ).resolves.not.toBe(digests.planDigest);
        expect(
            validateBlueprintPlanMetadataIntegrity(
                { ...digests, decisionSummary: { ...digests.decisionSummary, create: 2 } },
                digests
            )
        ).toMatchObject({ type: 'invalid' });
        await expect(
            createBlueprintPlanIntegrityDigests({
                guildId: 'target-guild',
                policy: 'synchronize',
                summary,
                authority,
                executionAuthority: { ...executionAuthority, initialIdMap: {} },
                steps,
                decisions,
            })
        ).rejects.toThrow('blueprint-plan-execution-authority');
        await expect(
            createBlueprintPlanIntegrityDigests({
                guildId: 'target-guild',
                policy: 'merge',
                summary,
                authority,
                executionAuthority,
                steps,
                decisions,
            })
        ).rejects.toThrow('blueprint-plan-policy-authority-mismatch');
    });

    it('keeps the plan creation request key stable across persistence timestamps', async () => {
        const input = {
            authority: authorityBody(),
            blockerCount: 0,
            createdByUserId: 'user-1',
            decisionLedger: { count: 1, digest: 'd'.repeat(64) },
            decisionSummary: {
                noOp: 0,
                create: 0,
                update: 0,
                delete: 1,
                protectedRetained: 0,
                protectedOmitted: 0,
                unmanagedRetained: 0,
                blockedAmbiguous: 0,
                blockedUnsupported: 0,
            },
            deleteLedger: { count: 1, digest: 'e'.repeat(64) },
            executionAuthorityDigest: 'f'.repeat(64),
            guildId: 'target-guild',
            policy: 'synchronize' as const,
            stepLedger: { count: 1, digest: 'a'.repeat(64) },
            summary: { creates: 0, updates: 0, deletes: 1, roles: 1, categories: 0, channels: 0 },
        };
        await expect(createBlueprintPlanCreationRequestKey(input)).resolves.toBe(
            await createBlueprintPlanCreationRequestKey({
                ...input,
                authority: {
                    ...input.authority,
                    provenance: {
                        ...input.authority.provenance,
                        requestedSnapshotStoredAt: '2026-07-16T12:00:00.000Z',
                    },
                },
            })
        );
    });

    it('binds preflight and terminal verification evidence', async () => {
        const mutationFenceManifest = await createBlueprintMutationFenceManifest(snapshot);
        const report = {
            summary: {
                total: 0,
                ready: 0,
                stale: 0,
                mappingRequired: 0,
                destructiveApprovalRequired: 0,
                unsupported: 0,
                invalidPlan: 0,
            },
            steps: [],
        };
        const preflightDigests = await createBlueprintPreflightEvidenceDigests({ report, mutationFenceManifest });
        const evidence = {
            version: 1 as const,
            preflightId: 'preflight-1',
            planId: 'plan-1',
            report,
            mutationFenceManifest,
            ...preflightDigests,
            createdAt: timestamp,
        };
        await expect(validateBlueprintPreflightEvidenceIntegrity(evidence)).resolves.toMatchObject({ type: 'valid' });
        await expect(
            validateBlueprintPreflightEvidenceIntegrity({
                ...evidence,
                report: { ...report, summary: { ...report.summary, total: 1 } },
            })
        ).resolves.toMatchObject({ type: 'invalid' });

        const result = {
            version: 1 as const,
            status: 'matched' as const,
            expectedStructureDigest: '1'.repeat(64),
            actualStructureDigest: '1'.repeat(64),
        };
        const verificationEvidenceDigest = await createBlueprintRunVerificationEvidenceDigest({
            runId: 'run-1',
            verificationStatus: 'matched',
            result,
        });
        const verificationEvidence = {
            version: 1 as const,
            runId: 'run-1',
            planId: 'plan-1',
            verificationStatus: 'matched' as const,
            result,
            verificationEvidenceDigest,
            createdAt: timestamp,
        };
        await expect(validateBlueprintRunVerificationEvidenceIntegrity(verificationEvidence)).resolves.toMatchObject({
            type: 'valid',
        });
        await expect(
            validateBlueprintRunVerificationEvidenceIntegrity({
                ...verificationEvidence,
                result: { ...result, status: 'mismatch' as const },
            })
        ).resolves.toMatchObject({ type: 'invalid' });
    });

    it('uses canonical SHA-256 and run protocol 7', async () => {
        await expect(sha256CanonicalJson({ b: 2, a: 1 })).resolves.toBe(await sha256CanonicalJson({ a: 1, b: 2 }));
        expect(BLUEPRINT_RUN_PROTOCOL_VERSION).toBe(7);
    });

    it('binds restore snapshots and every terminal integrity field', async () => {
        const restoreDigest = await createBlueprintRestorePointSnapshotDigest(snapshot);
        await expect(createBlueprintRestorePointSnapshotDigest({ ...snapshot, guildId: 'other' })).resolves.not.toBe(
            restoreDigest
        );
        const terminalRequest = {
            runId: 'run-1',
            requestedStatus: 'partially_applied' as const,
            errorType: 'provider-failed',
            sourceDigest: null,
            verificationStatus: null,
            verificationEvidenceDigest: null,
            verificationResult: null,
        };
        const terminalRequestDigest = await createBlueprintRunTerminalRequestDigest(terminalRequest);
        await expect(
            createBlueprintRunTerminalRequestDigest({
                ...terminalRequest,
                verificationResult: { status: 'changed' },
            })
        ).resolves.not.toBe(terminalRequestDigest);
        await expect(
            createBlueprintRunTerminalRequestDigest({
                ...terminalRequest,
                sourceDigest: 'f'.repeat(64),
            })
        ).resolves.not.toBe(terminalRequestDigest);
        await expect(
            createBlueprintRunTerminalRequestDigest({
                ...terminalRequest,
                verificationResult: { b: 2, a: 1 },
            })
        ).resolves.toBe(
            await createBlueprintRunTerminalRequestDigest({
                ...terminalRequest,
                verificationResult: { a: 1, b: 2 },
            })
        );
        const terminal = {
            runId: 'run-1',
            terminalRequestDigest,
            status: 'partially_applied' as const,
            errorType: 'provider-failed',
            restorePointBackupId: 'backup-1',
            restorePointSnapshotDigest: restoreDigest,
            verificationStatus: null,
            verificationEvidenceDigest: null,
            progress: {
                appliedSteps: 1,
                completedMutationSteps: 1,
                failedSteps: 1,
                nextStepSequence: 2,
                notStartedSteps: 1,
                skippedSteps: 0,
                totalSteps: 3,
                totalMutationSteps: 3,
            },
        };
        const digest = await createBlueprintRunTerminalDigest(terminal);
        await expect(createBlueprintRunTerminalDigest(terminal)).resolves.toBe(digest);
        await expect(
            createBlueprintRunTerminalDigest({ ...terminal, errorType: 'different-provider-failure' })
        ).resolves.not.toBe(digest);
        await expect(
            createBlueprintRunTerminalDigest({
                ...terminal,
                progress: { ...terminal.progress, appliedSteps: 2 },
            })
        ).resolves.not.toBe(digest);
        await expect(
            createBlueprintRunTerminalDigest({ ...terminal, restorePointBackupId: 'backup-2' })
        ).resolves.not.toBe(digest);
        await expect(
            createBlueprintRunTerminalDigest({ ...terminal, terminalRequestDigest: 'f'.repeat(64) })
        ).resolves.not.toBe(digest);
    });
});
