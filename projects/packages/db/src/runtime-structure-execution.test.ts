import { describe, expect, it, vi } from 'vitest';

import {
    authorizeStructureImportExecutionMutation,
    claimNextStructureImportExecution,
    enqueueStructureImportExecution,
} from './runtime-structure-execution.js';
import { STRUCTURE_EXECUTION_PROTOCOL_VERSION } from './runtime-contract.js';

describe('structure execution runtime boundary', () => {
    it.each([
        ['structure-execution-review-stale', 'structure-execution-review-stale'],
        ['structure-guild-execution-active', 'structure-guild-execution-active'],
        ['structure-execution-empty', 'structure-execution-empty'],
    ] as const)('preserves the %s enqueue conflict', async (message, type) => {
        const mutation = vi.fn().mockRejectedValue(new Error(message));

        const result = await enqueueStructureImportExecution({ client: { mutation } } as never, {
            now: new Date('2026-07-11T12:00:00.000Z'),
            preflightDigest: 'preflight-1',
            runId: 'run-1',
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type });
    });

    it('preserves a rejected live-fingerprint authorization as a safe terminal outcome', async () => {
        const mutation = vi.fn().mockResolvedValue({
            kind: 'rejected',
            reason: 'live_fingerprint_stale',
            execution: executionRecord({ status: 'failed_before_mutation' }),
        });

        const result = await authorizeStructureImportExecutionMutation({ client: { mutation } } as never, {
            executionId: 'execution-1',
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            liveFingerprint: 'live-2',
            now: new Date('2026-07-11T12:00:00.000Z'),
            structure: { roles: [], categories: [], channels: [] },
        });

        expect(result._unsafeUnwrap()).toMatchObject({
            kind: 'rejected',
            reason: 'live_fingerprint_stale',
            execution: { id: 'execution-1', status: 'failed_before_mutation' },
        });
        expect(mutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                liveFingerprint: 'live-2',
                protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
                structureJson: JSON.stringify({ roles: [], categories: [], channels: [] }),
            })
        );
    });

    it('preserves a protocol mismatch claim instead of treating it as idle', async () => {
        const mismatch = {
            executionId: 'execution-old',
            executionProtocolVersion: 7,
            guildId: 'guild-1',
            kind: 'protocol_mismatch',
            mayHaveExternalEffects: true,
            requiredProtocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
            status: 'paused',
        };
        const mutation = vi.fn().mockResolvedValue(mismatch);
        const result = await claimNextStructureImportExecution({ client: { mutation } } as never, {
            leaseExpiresAt: new Date('2026-07-11T12:03:00.000Z'),
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            now: new Date('2026-07-11T12:00:00.000Z'),
        });

        expect(result._unsafeUnwrap()).toStrictEqual(mismatch);
        expect(mutation).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION })
        );
    });

    it('rejects malformed mismatch metadata at the repository boundary', async () => {
        const mutation = vi.fn().mockResolvedValue({
            executionId: 'execution-old',
            executionProtocolVersion: '7',
            guildId: 'guild-1',
            kind: 'protocol_mismatch',
            mayHaveExternalEffects: true,
            requiredProtocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
            status: 'queued',
        });

        const result = await claimNextStructureImportExecution({ client: { mutation } } as never, {
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
            structureExecutionProtocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION + 1,
        });

        const result = await claimNextStructureImportExecution({ client: { mutation, query } } as never, {
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

        const result = await claimNextStructureImportExecution({ client: { mutation, query } } as never, {
            leaseExpiresAt: new Date('2026-07-11T12:03:00.000Z'),
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            now: new Date('2026-07-11T12:00:00.000Z'),
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'database-error' });
    });
});

function executionRecord(overrides: Record<string, unknown> = {}) {
    return {
        _id: 'execution-1',
        appliedActions: 0,
        completedMutationSteps: 0,
        createdAt: '2026-07-11T11:59:00.000Z',
        failedActions: 0,
        guildId: 'guild-1',
        idMap: {},
        mutationAuthorizedAt: null,
        mutationAuthorizationLeaseId: null,
        nextActionSequence: 0,
        notStartedActions: 1,
        phase: 'complete',
        preflightDigest: 'preflight-1',
        preflightExpiresAt: '2026-07-11T12:05:00.000Z',
        preflightLiveFingerprint: 'live-1',
        protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
        runId: 'run-1',
        skippedActions: 0,
        status: 'running',
        totalActions: 1,
        totalMutationSteps: 1,
        updatedAt: '2026-07-11T12:00:00.000Z',
        ...overrides,
    };
}
