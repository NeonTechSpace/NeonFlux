import { describe, expect, it } from 'vitest';

import { toBlueprintRun, toBlueprintRunCursor } from './runtime-blueprint-run-records.js';

describe('Blueprint run record decoding', () => {
    it('requires a positive durable run protocol version', () => {
        expect(toBlueprintRun(runRecord({ protocolVersion: 1 })).protocolVersion).toBe(1);
        expect(() => toBlueprintRun(runRecord({ protocolVersion: undefined }))).toThrow('invalid-number');
        expect(() => toBlueprintRun(runRecord({ protocolVersion: 0 }))).toThrow('invalid-positive-integer');
        expect(() => toBlueprintRun(runRecord({ protocolVersion: 1.5 }))).toThrow('invalid-positive-integer');
    });

    it('keeps mutable ID mappings in the cursor instead of the hot run record', () => {
        expect(toBlueprintRun(runRecord({ idMap: { source: 'target' } }))).not.toHaveProperty('idMap');
        expect(
            toBlueprintRunCursor({
                _id: 'cursor-1',
                version: 1,
                runId: 'run-1',
                planId: 'plan-1',
                idMap: { source: 'target' },
                updatedAt: '2026-07-11T12:00:00.000Z',
            })
        ).toMatchObject({ id: 'cursor-1', idMap: { source: 'target' } });
    });

    it('rejects malformed restore, verification, and terminal digests', () => {
        for (const field of [
            'restorePointSnapshotDigest',
            'verificationEvidenceDigest',
            'terminalDigest',
            'terminalRequestDigest',
        ]) {
            expect(() => toBlueprintRun(runRecord({ [field]: 'not-a-sha256' }))).toThrow('invalid-sha256');
        }
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
        nextStepSequence: 0,
        notStartedSteps: 1,
        phase: 'queued',
        preflightId: 'preflight-record-1',
        preflightDigest: 'preflight-1',
        preflightExpiresAt: '2026-07-11T12:05:00.000Z',
        fingerprintVersion: 2,
        expectedStructureFingerprint: 'structure-1',
        expectedCapabilityFingerprint: 'capability-1',
        executionAuthorityDigest: 'a'.repeat(64),
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
