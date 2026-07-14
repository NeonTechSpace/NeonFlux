import { describe, expect, it } from 'vitest';

import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import {
    assertCurrentBlueprintRunProtocol,
    isRunnableBlueprintRunProtocolMismatch,
    toBlueprintRunProtocolMismatch,
} from './blueprint_run_protocol.js';

describe('structure run protocol fence', () => {
    it('accepts only an exact durable protocol version', () => {
        expect(() =>
            assertCurrentBlueprintRunProtocol({
                _id: 'run-current',
                protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
            })
        ).not.toThrow();
        expect(() =>
            assertCurrentBlueprintRunProtocol({
                _id: 'run-old',
                protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION - 1,
            })
        ).toThrow('Run protocolVersion mismatch');
        expect(() =>
            assertCurrentBlueprintRunProtocol({
                _id: 'run-future',
                protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION + 1,
            })
        ).toThrow('Run protocolVersion mismatch');
    });

    it('conservatively marks a previously started mismatch as potentially externally visible', () => {
        expect(
            toBlueprintRunProtocolMismatch({
                _id: 'run-old',
                appliedSteps: 0,
                completedMutationSteps: 0,
                guildId: 'guild-1',
                nextStepSequence: 0,
                protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION + 1,
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
            isRunnableBlueprintRunProtocolMismatch(
                protocolRecord({ protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION, status: 'queued' }),
                now
            )
        ).toBe(false);
        expect(
            isRunnableBlueprintRunProtocolMismatch(
                protocolRecord({ protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION + 1, status: 'paused' }),
                now
            )
        ).toBe(false);
        expect(
            isRunnableBlueprintRunProtocolMismatch(
                protocolRecord({
                    leaseExpiresAt: '2026-07-11T11:59:00.000Z',
                    protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION + 1,
                    status: 'running',
                }),
                now
            )
        ).toBe(true);
        expect(
            isRunnableBlueprintRunProtocolMismatch(
                protocolRecord({
                    protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION + 1,
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
        _id: 'run-old',
        appliedSteps: 0,
        completedMutationSteps: 0,
        guildId: 'guild-1',
        nextStepSequence: 0,
        protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION + 1,
        status: 'queued',
        ...overrides,
    } as never;
}
