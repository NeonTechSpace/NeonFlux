import type { Doc, Id } from '../_generated/dataModel.js';
import { describe, expect, it } from 'vitest';

import { toHotRunRecord } from './blueprint_hot_records.js';

describe('Blueprint hot-record serializers', () => {
    it('excludes Convex metadata from a real run document shape', () => {
        const run = {
            _creationTime: 1_752_576_000_000,
            _id: 'run-1' as Id<'blueprintRuns'>,
            appliedSteps: 1,
            completedMutationSteps: 1,
            createdAt: '2026-07-16T04:00:00.000Z',
            executionAuthorityDigest: 'execution-authority-digest',
            expectedCapabilityFingerprint: 'capability-fingerprint',
            expectedStructureFingerprint: 'structure-fingerprint',
            failedSteps: 0,
            fingerprintVersion: 2,
            guildId: 'guild-1',
            nextStepSequence: 1,
            notStartedSteps: 0,
            phase: 'complete',
            planId: 'plan-1' as Id<'blueprintPlans'>,
            preflightDigest: 'preflight-digest',
            preflightExpiresAt: '2026-07-16T05:00:00.000Z',
            preflightId: 'preflight-1' as Id<'blueprintPlanPreflights'>,
            protocolVersion: 7,
            skippedSteps: 0,
            status: 'succeeded',
            totalMutationSteps: 1,
            totalSteps: 1,
            updatedAt: '2026-07-16T04:01:00.000Z',
            verificationEvidenceDigest: 'verification-evidence-digest',
            verificationEvidenceVersion: 1,
            verificationStatus: 'matched',
        } satisfies Doc<'blueprintRuns'>;

        const record = toHotRunRecord(run);

        expect(record).toMatchObject({
            id: 'run-1',
            planId: 'plan-1',
            preflightId: 'preflight-1',
            status: 'succeeded',
            verificationStatus: 'matched',
        });
        expect(record).not.toHaveProperty('_id');
        expect(record).not.toHaveProperty('_creationTime');
    });
});
