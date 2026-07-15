import { describe, expect, it } from 'vitest';

import { toBlueprintRun } from './runtime-blueprint-run-records.js';

describe('Blueprint run record decoding', () => {
    it('requires a positive durable run protocol version', () => {
        expect(toBlueprintRun(runRecord({ protocolVersion: 1 })).protocolVersion).toBe(1);
        expect(() => toBlueprintRun(runRecord({ protocolVersion: undefined }))).toThrow('invalid-number');
        expect(() => toBlueprintRun(runRecord({ protocolVersion: 0 }))).toThrow('invalid-positive-integer');
        expect(() => toBlueprintRun(runRecord({ protocolVersion: 1.5 }))).toThrow('invalid-positive-integer');
    });
});

function runRecord(overrides: Record<string, unknown> = {}) {
    return {
        _id: 'run-1',
        appliedSteps: 0,
        completedMutationSteps: 0,
        createdAt: '2026-07-11T12:00:00.000Z',
        failedSteps: 0,
        guildId: 'guild-1',
        idMap: {},
        nextStepSequence: 0,
        notStartedSteps: 1,
        phase: 'queued',
        preflightDigest: 'preflight-1',
        preflightExpiresAt: '2026-07-11T12:05:00.000Z',
        fingerprintVersion: 2,
        expectedStructureFingerprint: 'structure-1',
        expectedCapabilityFingerprint: 'capability-1',
        mutationAuthorizationLeaseId: null,
        protocolVersion: 1,
        planId: 'plan-1',
        skippedSteps: 0,
        status: 'queued',
        totalSteps: 1,
        totalMutationSteps: 1,
        updatedAt: '2026-07-11T12:00:00.000Z',
        ...overrides,
    };
}
