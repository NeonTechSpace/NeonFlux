import { describe, expect, it } from 'vitest';
import { createBlueprintRunVerificationEvidenceDigest } from '@neonflux/blueprint/integrity';

import { classifyBlueprintRunReclaim } from './blueprint_model.js';
import {
    buildBlueprintRunPausedPatch,
    buildBlueprintRunTerminalPatch,
    assertBlueprintRunTerminalInvariant,
    assertBlueprintRunTerminalRecordInvariant,
    createBlueprintRunControlCancellationRequestDigest,
    createBlueprintRunTerminalDigestForRecord,
    createBlueprintRunTerminalRequestDigestForRecord,
    resolveBlueprintRunFinalizationStatus,
    resolveBlueprintRunTerminalRetryRequestDigest,
    resolveBlueprintRunTerminalOutcome,
} from './blueprint_run_terminal_mutation.js';

describe('structure run expired-attempt finalization', () => {
    it('makes an expired pause-requested started attempt outcome-unknown and clears every control fence', () => {
        expect(
            classifyBlueprintRunReclaim({
                hasStartedAttempt: true,
                leaseExpiresAt: '2026-07-11T11:59:00.000Z',
                now: '2026-07-11T12:00:00.000Z',
            })
        ).toBe('outcome_unknown');

        expect(
            buildBlueprintRunTerminalPatch({
                errorType: 'expired-lease-with-started-attempt',
                now: '2026-07-11T12:00:00.000Z',
                status: 'outcome_unknown',
                terminalDigest: 'digest',
                terminalRequestDigest: 'request-digest',
            })
        ).toMatchObject({
            controlRequest: undefined,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            phase: 'complete',
            retryAt: undefined,
            status: 'outcome_unknown',
        });
    });

    it('honors control committed before a successful completion is finalized', () => {
        expect(
            resolveBlueprintRunFinalizationStatus({
                controlRequest: 'pause',
                runStatus: 'pause_requested',
                requestedStatus: 'succeeded',
            })
        ).toBe('paused');
        expect(
            resolveBlueprintRunFinalizationStatus({
                controlRequest: 'cancel',
                runStatus: 'pause_requested',
                requestedStatus: 'needs_reconciliation',
            })
        ).toBe('cancelled');
        expect(buildBlueprintRunPausedPatch('2026-07-12T12:00:00.000Z')).toMatchObject({
            controlRequest: undefined,
            heartbeatAt: undefined,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            phase: 'paused',
            retryAt: undefined,
            status: 'paused',
        });
        expect(
            resolveBlueprintRunTerminalOutcome({
                controlRequest: 'cancel',
                forcedErrorType: 'verification-evidence-invalid',
                requestedStatus: 'needs_reconciliation',
                runStatus: 'pause_requested',
            })
        ).toStrictEqual({
            errorType: 'verification-evidence-invalid',
            preservesVerificationEvidence: false,
            status: 'cancelled',
        });
    });

    it('uses the forced reconciliation error consistently in the resolved terminal outcome', () => {
        expect(
            resolveBlueprintRunTerminalOutcome({
                forcedErrorType: 'verification-evidence-too-large',
                requestedErrorType: 'caller-error',
                requestedStatus: 'needs_reconciliation',
                runStatus: 'verifying',
            })
        ).toStrictEqual({
            errorType: 'verification-evidence-too-large',
            preservesVerificationEvidence: true,
            status: 'needs_reconciliation',
        });
    });

    it('uses one stable terminal request identity for direct and worker-committed cancellation', async () => {
        const terminalRequestDigest = await createBlueprintRunControlCancellationRequestDigest('run-1');
        const botFinalizationDigest = await createBlueprintRunTerminalRequestDigestForRecord({
            runId: 'run-1',
            requestedStatus: 'succeeded',
            verificationEvidenceDigest: 'a'.repeat(64),
            verificationResult: { version: 1, status: 'matched' },
            verificationStatus: 'matched',
        });
        await expect(
            resolveBlueprintRunTerminalRetryRequestDigest({
                requestedTerminalRequestDigest: botFinalizationDigest,
                runId: 'run-1',
                status: 'cancelled',
                storedTerminalRequestDigest: terminalRequestDigest,
            })
        ).resolves.toBe(terminalRequestDigest);
        const run = {
            _id: 'run-1',
            planId: 'plan-1',
            appliedSteps: 1,
            completedMutationSteps: 1,
            failedSteps: 0,
            nextStepSequence: 1,
            notStartedSteps: 1,
            skippedSteps: 0,
            totalSteps: 2,
            totalMutationSteps: 2,
            status: 'cancelled',
            terminalRequestDigest,
        };
        const terminalDigest = await createBlueprintRunTerminalDigestForRecord({
            run: run as never,
            status: 'cancelled',
            terminalRequestDigest,
        });

        await expect(
            assertBlueprintRunTerminalRecordInvariant({
                evidence: null,
                expectedTerminalRequestDigest: await createBlueprintRunControlCancellationRequestDigest('run-1'),
                run: { ...run, terminalDigest } as never,
                status: 'cancelled',
            })
        ).resolves.toBeUndefined();
    });

    it.each(['partially_applied', 'failed_before_mutation', 'outcome_unknown'] as const)(
        'does not let a concurrent control request hide the %s terminal outcome',
        (requestedStatus) => {
            expect(
                resolveBlueprintRunFinalizationStatus({
                    controlRequest: 'cancel',
                    runStatus: 'pause_requested',
                    requestedStatus,
                })
            ).toBe(requestedStatus);
        }
    );

    it('allows success only for a complete, failure-free, matched run', () => {
        const complete = {
            appliedSteps: 2,
            completedMutationSteps: 2,
            failedSteps: 0,
            nextStepSequence: 2,
            notStartedSteps: 0,
            skippedSteps: 0,
            totalSteps: 2,
        };
        expect(() =>
            assertBlueprintRunTerminalInvariant({
                run: complete,
                status: 'succeeded',
                verificationEvidenceDigest: 'a'.repeat(64),
                verificationEvidenceVersion: 1,
                verificationStatus: 'matched',
            })
        ).not.toThrow();
        expect(() =>
            assertBlueprintRunTerminalInvariant({
                run: { ...complete, nextStepSequence: 1, notStartedSteps: 1 },
                status: 'succeeded',
                verificationEvidenceDigest: 'a'.repeat(64),
                verificationEvidenceVersion: 1,
                verificationStatus: 'matched',
            })
        ).toThrow('blueprint-run-terminal-progress-invalid');
        expect(() =>
            assertBlueprintRunTerminalInvariant({
                run: complete,
                status: 'succeeded',
                verificationEvidenceDigest: 'a'.repeat(64),
                verificationEvidenceVersion: 1,
                verificationStatus: 'mismatch',
            })
        ).toThrow('blueprint-run-terminal-progress-invalid');
        expect(() =>
            assertBlueprintRunTerminalInvariant({
                run: complete,
                status: 'cancelled',
                verificationEvidenceDigest: 'a'.repeat(64),
                verificationEvidenceVersion: 1,
                verificationStatus: 'matched',
            })
        ).toThrow('blueprint-run-terminal-progress-invalid');
        expect(() =>
            assertBlueprintRunTerminalInvariant({
                run: complete,
                status: 'needs_reconciliation',
            })
        ).toThrow('blueprint-run-terminal-progress-invalid');
    });

    it('closes a forced-reconciliation terminal record over the original request and durable evidence', async () => {
        const result = {
            version: 1 as const,
            status: 'read_failed' as const,
            reason: 'verification-evidence-invalid',
        } as const;
        const verificationEvidenceDigest = await createBlueprintRunVerificationEvidenceDigest({
            runId: 'run-1',
            verificationStatus: 'read_failed',
            result,
        });
        const terminalRequestDigest = await createBlueprintRunTerminalRequestDigestForRecord({
            runId: 'run-1',
            requestedStatus: 'succeeded',
            verificationEvidenceDigest: 'invalid-digest',
            verificationResult: { version: 1, status: 'matched' },
            verificationStatus: 'matched',
        });
        const run = {
            _id: 'run-1',
            planId: 'plan-1',
            appliedSteps: 2,
            completedMutationSteps: 2,
            failedSteps: 0,
            nextStepSequence: 2,
            notStartedSteps: 0,
            skippedSteps: 0,
            totalSteps: 2,
            totalMutationSteps: 2,
            errorType: 'verification-evidence-invalid',
            status: 'needs_reconciliation',
            terminalRequestDigest,
            verificationEvidenceDigest,
            verificationEvidenceVersion: 1,
            verificationStatus: 'read_failed',
        };
        const terminalDigest = await createBlueprintRunTerminalDigestForRecord({
            run: run as never,
            errorType: 'verification-evidence-invalid',
            status: 'needs_reconciliation',
            terminalRequestDigest,
            verificationEvidenceDigest,
            verificationStatus: 'read_failed',
        });
        const sealedRun = { ...run, terminalDigest } as never;
        const evidence = {
            _id: 'evidence-1',
            _creationTime: 1,
            version: 1,
            runId: 'run-1',
            planId: 'plan-1',
            verificationStatus: 'read_failed',
            result,
            verificationEvidenceDigest,
            createdAt: '2026-07-15T12:00:00.000Z',
        } as never;

        await expect(
            assertBlueprintRunTerminalRecordInvariant({
                evidence,
                expectedTerminalRequestDigest: terminalRequestDigest,
                run: sealedRun,
                status: 'needs_reconciliation',
            })
        ).resolves.toBeUndefined();
        await expect(
            assertBlueprintRunTerminalRecordInvariant({
                evidence,
                expectedTerminalRequestDigest: 'f'.repeat(64),
                run: sealedRun,
                status: 'needs_reconciliation',
            })
        ).rejects.toThrow('blueprint-run-finalization-conflict');
        await expect(
            assertBlueprintRunTerminalRecordInvariant({
                evidence: null,
                expectedTerminalRequestDigest: terminalRequestDigest,
                run: sealedRun,
                status: 'needs_reconciliation',
            })
        ).rejects.toThrow('blueprint-run-finalization-conflict');
    });
});
