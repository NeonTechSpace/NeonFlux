import { describe, expect, it } from 'vitest';

import { STRUCTURE_EXECUTION_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import {
    assertCurrentStructureExecutionProtocol,
    isRunnableStructureExecutionProtocolMismatch,
    toStructureExecutionProtocolMismatch,
} from './structure_import_execution_protocol.js';

describe('structure execution protocol fence', () => {
    it('accepts only an exact durable protocol version', () => {
        expect(() =>
            assertCurrentStructureExecutionProtocol({
                _id: 'execution-current',
                protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
            })
        ).not.toThrow();
        expect(() =>
            assertCurrentStructureExecutionProtocol({
                _id: 'execution-old',
                protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION - 1,
            })
        ).toThrow('Execution protocolVersion mismatch');
        expect(() =>
            assertCurrentStructureExecutionProtocol({
                _id: 'execution-future',
                protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION + 1,
            })
        ).toThrow('Execution protocolVersion mismatch');
    });

    it('conservatively marks a previously started mismatch as potentially externally visible', () => {
        expect(
            toStructureExecutionProtocolMismatch({
                _id: 'execution-old',
                appliedActions: 0,
                completedMutationSteps: 0,
                guildId: 'guild-1',
                nextActionSequence: 0,
                protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION + 1,
                startedAt: '2026-07-11T12:00:00.000Z',
                status: 'queued',
            })
        ).toMatchObject({
            kind: 'protocol_mismatch',
            mayHaveExternalEffects: true,
            status: 'queued',
        });
    });

    it('reports only otherwise-runnable old rows and never reclaims paused mismatches', () => {
        const now = '2026-07-11T12:00:00.000Z';

        expect(
            isRunnableStructureExecutionProtocolMismatch(
                protocolRecord({ protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION, status: 'queued' }),
                now
            )
        ).toBe(false);
        expect(
            isRunnableStructureExecutionProtocolMismatch(
                protocolRecord({ protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION + 1, status: 'paused' }),
                now
            )
        ).toBe(false);
        expect(
            isRunnableStructureExecutionProtocolMismatch(
                protocolRecord({
                    leaseExpiresAt: '2026-07-11T11:59:00.000Z',
                    protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION + 1,
                    status: 'running',
                }),
                now
            )
        ).toBe(true);
        expect(
            isRunnableStructureExecutionProtocolMismatch(
                protocolRecord({
                    protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION + 1,
                    retryAt: '2026-07-11T12:01:00.000Z',
                    status: 'waiting_rate_limit',
                }),
                now
            )
        ).toBe(false);
    });
});

function protocolRecord(overrides: Record<string, unknown> = {}) {
    return {
        _id: 'execution-old',
        appliedActions: 0,
        completedMutationSteps: 0,
        guildId: 'guild-1',
        nextActionSequence: 0,
        protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION + 1,
        status: 'queued',
        ...overrides,
    } as never;
}
