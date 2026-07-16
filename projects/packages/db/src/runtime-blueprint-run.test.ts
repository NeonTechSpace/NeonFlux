import { describe, expect, it, vi } from 'vitest';
import { createBlueprintPlanAuthority } from '@neonflux/blueprint/integrity';
import { normalizeBlueprintPlanAuthority } from '@neonflux/blueprint/persisted-authority';

import {
    authorizeBlueprintRunMutation,
    claimNextBlueprintRun,
    enqueueBlueprintRun,
    findActiveBlueprintRun,
    recordBlueprintPlanPreflight,
} from './runtime-blueprint-run.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from './runtime-contract.js';

describe('Blueprint run runtime boundary', () => {
    it('reads the indexed active run for the requested guild', async () => {
        const query = vi.fn().mockResolvedValue(runRecord({ status: 'running' }));

        const result = await findActiveBlueprintRun({ client: { query } } as never, {
            guildId: 'guild-1',
        });

        expect(result._unsafeUnwrap()).toMatchObject({ guildId: 'guild-1', status: 'running' });
        expect(query).toHaveBeenCalledWith(expect.anything(), { guildId: 'guild-1' });
    });

    it.each([
        ['blueprint-run-review-stale', 'blueprint-run-review-stale'],
        ['blueprint-guild-run-active', 'blueprint-guild-run-active'],
        ['blueprint-run-empty', 'blueprint-run-empty'],
    ] as const)('preserves the %s enqueue conflict', async (message, type) => {
        const mutation = vi.fn().mockRejectedValue(new Error(message));

        const result = await enqueueBlueprintRun({ client: { mutation } } as never, {
            now: new Date('2026-07-11T12:00:00.000Z'),
            preflightDigest: 'preflight-1',
            planId: 'plan-1',
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type });
    });

    it('preserves a rejected semantic-fence authorization as a safe terminal outcome', async () => {
        const mutation = vi.fn().mockResolvedValue({
            kind: 'rejected',
            reason: 'structure_changed',
            run: runRecord({ status: 'failed_before_mutation' }),
        });

        const result = await authorizeBlueprintRunMutation({ client: { mutation } } as never, {
            runId: 'run-1',
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            manifest: { version: 2, structureDigest: 'structure-2' },
            now: new Date('2026-07-11T12:00:00.000Z'),
            observedAt: new Date('2026-07-11T11:59:59.000Z'),
            structure: { roles: [], categories: [], channels: [] },
        });

        expect(result._unsafeUnwrap()).toMatchObject({
            kind: 'rejected',
            reason: 'structure_changed',
            run: { id: 'run-1', status: 'failed_before_mutation' },
        });
        expect(mutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                fingerprintVersion: 2,
                manifestJson: JSON.stringify({ version: 2, structureDigest: 'structure-2' }),
                observedAt: '2026-07-11T11:59:59.000Z',
                protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
                structureJson: JSON.stringify({ roles: [], categories: [], channels: [] }),
            })
        );
    });

    it('preserves a protocol mismatch claim instead of treating it as idle', async () => {
        const mismatch = {
            runId: 'run-old',
            runProtocolVersion: 7,
            guildId: 'guild-1',
            kind: 'protocol_mismatch',
            mayHaveExternalEffects: true,
            requiredProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
            status: 'paused',
        };
        const mutation = vi.fn().mockResolvedValue(mismatch);
        const result = await claimNextBlueprintRun({ client: { mutation } } as never, {
            leaseExpiresAt: new Date('2026-07-11T12:03:00.000Z'),
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            now: new Date('2026-07-11T12:00:00.000Z'),
        });

        expect(result._unsafeUnwrap()).toStrictEqual(mismatch);
        expect(mutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION })
        );
    });

    it('preserves a terminal authority-invalid claim instead of retrying the cold authority', async () => {
        const invalidClaim = {
            kind: 'authority_invalid',
            errorType: 'blueprint-plan-integrity-mismatch',
            guildId: 'guild-1',
            mayHaveExternalEffects: false,
            runId: 'run-1',
            status: 'failed_before_mutation',
        };
        const mutation = vi.fn().mockResolvedValue(invalidClaim);
        const result = await claimNextBlueprintRun({ client: { mutation } } as never, {
            leaseExpiresAt: new Date('2026-07-11T12:03:00.000Z'),
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            now: new Date('2026-07-11T12:00:00.000Z'),
        });

        expect(result._unsafeUnwrap()).toStrictEqual(invalidClaim);
    });

    it('rejects malformed mismatch metadata at the repository boundary', async () => {
        const mutation = vi.fn().mockResolvedValue({
            runId: 'run-old',
            runProtocolVersion: '7',
            guildId: 'guild-1',
            kind: 'protocol_mismatch',
            mayHaveExternalEffects: true,
            requiredProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
            status: 'queued',
        });

        const result = await claimNextBlueprintRun({ client: { mutation } } as never, {
            leaseExpiresAt: new Date('2026-07-11T12:03:00.000Z'),
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            now: new Date('2026-07-11T12:00:00.000Z'),
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'database-error' });
    });

    it('classifies an exact runtime-contract mismatch as globally incompatible', async () => {
        const mutation = vi.fn().mockRejectedValue(new Error('claim rejected'));
        const query = vi.fn().mockResolvedValue({
            blueprintRunProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION + 1,
        });

        const result = await claimNextBlueprintRun({ client: { mutation, query } } as never, {
            leaseExpiresAt: new Date('2026-07-11T12:03:00.000Z'),
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            now: new Date('2026-07-11T12:00:00.000Z'),
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'backend-incompatible' });
    });

    it('keeps runtime-contract unavailability retryable as a database failure', async () => {
        const mutation = vi.fn().mockRejectedValue(new Error('claim unavailable'));
        const query = vi.fn().mockRejectedValue(new Error('network unavailable'));

        const result = await claimNextBlueprintRun({ client: { mutation, query } } as never, {
            leaseExpiresAt: new Date('2026-07-11T12:03:00.000Z'),
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            now: new Date('2026-07-11T12:00:00.000Z'),
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'database-error' });
    });

    it('serializes preflight authority without repository metadata', async () => {
        const mutation = vi.fn().mockRejectedValue(new Error('stop after capture'));
        const authority = await authorityRecord();

        const result = await recordBlueprintPlanPreflight({ client: { mutation } } as never, preflightInput(authority));

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'database-error' });
        const request = mutation.mock.calls[0]?.[1] as Record<string, unknown>;
        const sealedPlan = request.sealedPlan as Record<string, unknown>;
        const serializedAuthority = sealedPlan.authority as Record<string, unknown>;
        expect(Object.keys(serializedAuthority).sort()).toStrictEqual(
            [
                'authorityDigest',
                'blockers',
                'createdAt',
                'guildId',
                'mappings',
                'planId',
                'projectedSnapshot',
                'provenance',
                'referenceAuthority',
                'requestedSnapshot',
                'roleProjection',
                'version',
            ].sort()
        );
        expect(serializedAuthority).not.toHaveProperty('id');
        expect(serializedAuthority.createdAt).toBe('2026-07-15T12:00:00.000Z');
        expect(normalizeBlueprintPlanAuthority(serializedAuthority)).toMatchObject({ type: 'valid' });
    });

    it('rejects malformed preflight authority before calling Convex', async () => {
        const mutation = vi.fn();
        const authority = await authorityRecord();

        const result = await recordBlueprintPlanPreflight(
            { client: { mutation } } as never,
            preflightInput({ ...authority, createdAt: new Date(Number.NaN) })
        );

        expect(result._unsafeUnwrapErr()).toStrictEqual({ field: 'sealedPlan.authority', type: 'invalid-value' });
        expect(mutation).not.toHaveBeenCalled();
    });
});

async function authorityRecord() {
    const createdAt = '2026-07-15T12:00:00.000Z';
    const authority = await createBlueprintPlanAuthority({
        planId: 'plan-1',
        guildId: 'guild-1',
        createdAt,
        body: {
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
                mode: 'synchronize',
                roles: [],
                skippedProtectedSourceIds: [],
                retainedProtectedTargetIds: [],
            },
            mappings: { roles: {}, categories: {}, channels: {} },
            referenceAuthority: {
                sourceTargetMap: {},
                knownTargetKinds: { 'guild-1': 'role' },
            },
            blockers: [],
            provenance: {
                source: 'dashboard-json',
                requestedGuildId: 'source-guild',
                requestedExportedAt: null,
                requestedSnapshotStoredAt: createdAt,
            },
        },
    });
    return { ...authority, id: 'authority-1', createdAt: new Date(authority.createdAt) };
}

function preflightInput(authority: Awaited<ReturnType<typeof authorityRecord>>) {
    const checkedAt = new Date('2026-07-15T12:00:00.000Z');
    const summary = {
        total: 0,
        ready: 0,
        stale: 0,
        mappingRequired: 0,
        destructiveApprovalRequired: 0,
        unsupported: 0,
        invalidPlan: 0,
    };
    return {
        metadata: {
            planId: 'plan-1',
            guildId: 'guild-1',
            status: 'ready' as const,
            summary,
            checkedAt,
            observedAt: checkedAt,
            expiresAt: new Date('2026-07-15T12:05:00.000Z'),
            observationSource: 'resident-client' as const,
            planDigest: 'plan-digest',
            fingerprintVersion: 2 as const,
            structureFingerprint: 'structure-digest',
            capabilityFingerprint: 'capability-digest',
            evidenceVersion: 1 as const,
            evidenceDigest: 'evidence-digest',
            preflightDigest: 'preflight-digest',
        },
        evidence: {
            version: 1 as const,
            report: { summary, steps: [] },
            mutationFenceManifest: {
                version: 2 as const,
                guildId: 'guild-1',
                structureDigest: 'structure-digest',
                capabilityDigest: 'capability-digest',
                roles: [],
                categories: [],
                channels: [],
                capabilityFields: [],
            },
            reportDigest: 'report-digest',
            manifestDigest: 'manifest-digest',
            evidenceDigest: 'evidence-digest',
        },
        sealedPlan: { authority, decisions: [], steps: [] },
    };
}

function runRecord(overrides: Record<string, unknown> = {}) {
    return {
        _id: 'run-1',
        appliedSteps: 0,
        completedMutationSteps: 0,
        createdAt: '2026-07-11T11:59:00.000Z',
        failedSteps: 0,
        guildId: 'guild-1',
        preflightId: 'preflight-record-1',
        mutationAuthorizedAt: null,
        mutationAuthorizationLeaseId: null,
        nextStepSequence: 0,
        notStartedSteps: 1,
        phase: 'complete',
        preflightDigest: 'preflight-1',
        preflightExpiresAt: '2026-07-11T12:05:00.000Z',
        restorePointSnapshotDigest: null,
        terminalDigest: null,
        terminalRequestDigest: null,
        fingerprintVersion: 2,
        expectedStructureFingerprint: 'structure-1',
        expectedCapabilityFingerprint: 'capability-1',
        executionAuthorityDigest: 'a'.repeat(64),
        protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        planId: 'plan-1',
        skippedSteps: 0,
        status: 'running',
        totalSteps: 1,
        totalMutationSteps: 1,
        updatedAt: '2026-07-11T12:00:00.000Z',
        ...overrides,
    };
}
