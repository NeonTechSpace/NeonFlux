import { describe, expect, it, vi } from 'vitest';

import { claimNextStructureImportExecution } from './runtime-structure-execution.js';
import { STRUCTURE_EXECUTION_PROTOCOL_VERSION } from './runtime-contract.js';

describe('structure execution runtime boundary', () => {
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
