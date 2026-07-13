import { describe, expect, it } from 'vitest';

import { toExecution } from './runtime-structure-execution-records.js';

describe('structure execution record decoding', () => {
    it('requires a positive durable execution protocol version', () => {
        expect(toExecution(executionRecord({ protocolVersion: 1 })).protocolVersion).toBe(1);
        expect(() => toExecution(executionRecord({ protocolVersion: undefined }))).toThrow('invalid-number');
        expect(() => toExecution(executionRecord({ protocolVersion: 0 }))).toThrow('invalid-positive-integer');
        expect(() => toExecution(executionRecord({ protocolVersion: 1.5 }))).toThrow('invalid-positive-integer');
    });
});

function executionRecord(overrides: Record<string, unknown> = {}) {
    return {
        _id: 'execution-1',
        appliedActions: 0,
        completedMutationSteps: 0,
        createdAt: '2026-07-11T12:00:00.000Z',
        failedActions: 0,
        guildId: 'guild-1',
        idMap: {},
        nextActionSequence: 0,
        notStartedActions: 1,
        phase: 'queued',
        preflightDigest: 'preflight-1',
        preflightExpiresAt: '2026-07-11T12:05:00.000Z',
        preflightLiveFingerprint: 'live-1',
        mutationAuthorizationLeaseId: null,
        protocolVersion: 1,
        runId: 'run-1',
        skippedActions: 0,
        status: 'queued',
        totalActions: 1,
        totalMutationSteps: 1,
        updatedAt: '2026-07-11T12:00:00.000Z',
        ...overrides,
    };
}
