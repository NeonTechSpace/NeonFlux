import { describe, expect, it } from 'vitest';

import {
    createBlueprintPlanAuthority,
    createBlueprintPlanIntegrityDigests,
    deriveBlueprintPlanExecutionAuthority,
    type BlueprintPlanAuthorityBodyV1,
    type BlueprintPlanDecisionLedgerEntryV1,
    type BlueprintPlanStepLedgerEntryV1,
} from '@neonflux/blueprint';
import type { BlueprintRunClaimRecord } from '@neonflux/db';

import { validateClaimedBlueprintRunAuthority } from './bot-blueprint-run-authority.js';

const createdAt = '2026-07-15T12:00:00.000Z';

describe('Blueprint protocol-v7 worker authority', () => {
    it('independently validates the full authority, projection, cursor, ledgers, and plan digest', async () => {
        const claim = await validClaim();

        await expect(validateClaimedBlueprintRunAuthority(claim)).resolves.toMatchObject({
            type: 'valid',
            value: {
                cursor: { idMap: {} },
                steps: [{ sequence: 0, actionType: 'create', targetType: 'role' }],
            },
        });
    });

    it('rejects ledger substitution before provider access', async () => {
        const claim = await validClaim();
        const persistedStep = claim.steps[0];
        if (!persistedStep) throw new Error('missing-test-step');
        if (persistedStep.step.actionType !== 'create' || persistedStep.step.targetType !== 'role') {
            throw new Error('unexpected-test-step');
        }
        persistedStep.step = {
            ...persistedStep.step,
            label: 'Substituted',
            details: { ...persistedStep.step.details, label: 'Substituted' },
        };

        await expect(validateClaimedBlueprintRunAuthority(claim)).resolves.toEqual({
            type: 'invalid',
            errorType: 'invalid-blueprint-plan-step-ledger',
        });
    });

    it('rejects independently changed execution authority and a substituted cursor', async () => {
        const executionClaim = await validClaim();
        executionClaim.executionAuthority.knownTargetKinds['other-role'] = 'role';
        await expect(validateClaimedBlueprintRunAuthority(executionClaim)).resolves.toMatchObject({
            type: 'invalid',
            errorType: 'invalid-blueprint-plan-execution-authority',
        });

        const cursorClaim = await validClaim();
        cursorClaim.cursor.runId = 'different-run';
        await expect(validateClaimedBlueprintRunAuthority(cursorClaim)).resolves.toEqual({
            type: 'invalid',
            errorType: 'blueprint-run-cursor-link-mismatch',
        });
    });

    it('rejects substituted plan metadata even when every child record is intact', async () => {
        const claim = await validClaim();
        claim.plan.planDigest = 'f'.repeat(64);

        await expect(validateClaimedBlueprintRunAuthority(claim)).resolves.toEqual({
            type: 'invalid',
            errorType: 'blueprint-run-plan-digest-mismatch',
        });

        const runBindingClaim = await validClaim();
        runBindingClaim.run.executionAuthorityDigest = 'f'.repeat(64);
        await expect(validateClaimedBlueprintRunAuthority(runBindingClaim)).resolves.toEqual({
            type: 'invalid',
            errorType: 'blueprint-run-plan-metadata-mismatch',
        });
    });

    it('rejects a claimed older protocol even when its authority otherwise matches', async () => {
        const claim = await validClaim();
        claim.run.protocolVersion = 6;

        await expect(validateClaimedBlueprintRunAuthority(claim)).resolves.toEqual({
            type: 'invalid',
            errorType: 'blueprint-run-authority-version-mismatch',
        });
    });
});

async function validClaim(): Promise<Extract<BlueprintRunClaimRecord, { kind: 'claimed' }>> {
    const authorityBody: BlueprintPlanAuthorityBodyV1 = {
        requestedSnapshot: {
            version: 1,
            guildId: 'source-guild',
            roles: [],
            categories: [],
            channels: [],
        },
        projectedSnapshot: {
            version: 1,
            guildId: 'guild-1',
            roles: [],
            categories: [],
            channels: [],
        },
        roleProjection: {
            version: 2,
            mode: 'merge',
            roles: [],
            skippedProtectedSourceIds: [],
            retainedProtectedTargetIds: [],
        },
        mappings: { roles: {}, categories: {}, channels: {} },
        referenceAuthority: {
            sourceTargetMap: { 'source-role': null },
            knownTargetKinds: { 'guild-1': 'role' },
        },
        blockers: [],
        provenance: {
            source: 'dashboard-json',
            requestedGuildId: 'source-guild',
            requestedExportedAt: null,
            requestedSnapshotStoredAt: createdAt,
        },
    };
    const steps: BlueprintPlanStepLedgerEntryV1[] = [
        {
            sequence: 0,
            step: {
                actionType: 'create',
                targetType: 'role',
                targetId: 'source-role',
                label: 'Member',
                details: {
                    label: 'Member',
                    after: {
                        id: 'source-role',
                        name: 'Member',
                        position: 1,
                        hierarchyRank: 1,
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
                classification: 'create',
                reason: 'source-unmatched',
                sourceId: 'source-role',
            },
        },
    ];
    const authority = await createBlueprintPlanAuthority({
        planId: 'plan-1',
        guildId: 'guild-1',
        body: authorityBody,
        createdAt,
    });
    const executionAuthority = await deriveBlueprintPlanExecutionAuthority({
        planId: 'plan-1',
        guildId: 'guild-1',
        authority,
        createdAt,
    });
    const digests = await createBlueprintPlanIntegrityDigests({
        guildId: 'guild-1',
        policy: 'merge',
        summary: { creates: 1, updates: 0, deletes: 0, roles: 1, categories: 0, channels: 0 },
        authority,
        executionAuthority,
        steps,
        decisions,
    });

    return {
        kind: 'claimed',
        run: {
            id: 'run-1',
            planId: 'plan-1',
            guildId: 'guild-1',
            preflightId: 'preflight-1',
            preflightDigest: 'preflight-digest',
            preflightExpiresAt: new Date('2026-07-15T13:00:00.000Z'),
            fingerprintVersion: 2,
            expectedStructureFingerprint: 'structure-fingerprint',
            expectedCapabilityFingerprint: 'capability-fingerprint',
            executionAuthorityDigest: digests.executionAuthorityDigest,
            authorizationDecision: null,
            authorizationMismatch: null,
            mutationAuthorizedAt: null,
            mutationAuthorizationLeaseId: null,
            protocolVersion: 7,
            status: 'running',
            nextStepSequence: 0,
            notStartedSteps: 1,
            phase: 'preparing',
            totalSteps: 1,
            totalMutationSteps: 1,
            completedMutationSteps: 0,
            appliedSteps: 0,
            failedSteps: 0,
            skippedSteps: 0,
            retryAt: null,
            errorType: null,
            currentStepDomain: null,
            currentStepId: null,
            currentStepLabel: null,
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            leaseExpiresAt: new Date('2026-07-15T12:03:00.000Z'),
            heartbeatAt: new Date(createdAt),
            startedAt: new Date(createdAt),
            completedAt: null,
            controlRequest: null,
            restorePointBackupId: null,
            restorePointSnapshotDigest: null,
            verificationStatus: null,
            verificationEvidenceVersion: null,
            verificationEvidenceDigest: null,
            terminalDigest: null,
            terminalRequestDigest: null,
            createdAt: new Date(createdAt),
            updatedAt: new Date(createdAt),
        },
        plan: {
            id: 'plan-1',
            guildId: 'guild-1',
            sourceBackupId: null,
            status: 'approved',
            policy: 'merge',
            planVersion: 4,
            authorityVersion: 1,
            executionAuthorityVersion: 1,
            ...digests,
            createdByUserId: null,
            createdAt: new Date(createdAt),
            updatedAt: new Date(createdAt),
        },
        authority: { id: 'authority-1', ...authority, createdAt: new Date(authority.createdAt) },
        executionAuthority: {
            id: 'execution-authority-1',
            ...executionAuthority,
            createdAt: new Date(executionAuthority.createdAt),
        },
        cursor: {
            id: 'cursor-1',
            version: 1,
            runId: 'run-1',
            planId: 'plan-1',
            idMap: {},
            updatedAt: new Date(createdAt),
        },
        steps: steps.map(({ sequence, step }) => ({
            id: 'step-1',
            planId: 'plan-1',
            sequence,
            step,
            createdAt: new Date(createdAt),
        })),
        decisions: decisions.map(({ sequence, decision }) => ({
            id: 'decision-1',
            planId: 'plan-1',
            sequence,
            decision,
            createdAt: new Date(createdAt),
        })),
        attempts: [],
    };
}
