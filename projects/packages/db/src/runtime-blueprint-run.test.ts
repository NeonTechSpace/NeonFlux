import { describe, expect, it, vi } from 'vitest';

import {
    authorizeBlueprintRunMutation,
    claimNextBlueprintRun,
    enqueueBlueprintRun,
    findActiveBlueprintRun,
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
        ['blueprint-run-review-obsolete', 'blueprint-run-review-obsolete'],
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

    it('preserves a rejected live-fingerprint authorization as a safe terminal outcome', async () => {
        const mutation = vi.fn().mockResolvedValue({
            kind: 'rejected',
            reason: 'live_fingerprint_stale',
            run: runRecord({ status: 'failed_before_mutation' }),
        });

        const result = await authorizeBlueprintRunMutation({ client: { mutation } } as never, {
            runId: 'run-1',
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            liveFingerprint: 'live-2',
            now: new Date('2026-07-11T12:00:00.000Z'),
            structure: { roles: [], categories: [], channels: [] },
        });

        expect(result._unsafeUnwrap()).toMatchObject({
            kind: 'rejected',
            reason: 'live_fingerprint_stale',
            run: { id: 'run-1', status: 'failed_before_mutation' },
        });
        expect(mutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                liveFingerprint: 'live-2',
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
});

function runRecord(overrides: Record<string, unknown> = {}) {
    return {
        _id: 'run-1',
        appliedSteps: 0,
        completedMutationSteps: 0,
        createdAt: '2026-07-11T11:59:00.000Z',
        failedSteps: 0,
        guildId: 'guild-1',
        idMap: {},
        mutationAuthorizedAt: null,
        mutationAuthorizationLeaseId: null,
        nextStepSequence: 0,
        notStartedSteps: 1,
        phase: 'complete',
        preflightDigest: 'preflight-1',
        preflightExpiresAt: '2026-07-11T12:05:00.000Z',
        preflightLiveFingerprint: 'live-1',
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
