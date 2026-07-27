import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '@neonflux/blueprint';
import { describe, expect, it } from 'vitest';

import {
    decideBlueprintClaim,
    decideBlueprintPostApply,
    decideProviderAction,
    finalStatusForVerification,
    mutationFenceConstructionError,
    phaseForProviderStep,
    terminalStatusForAppliedSteps,
} from './bot-blueprint-run-decisions.js';

describe('Blueprint run orchestration decisions', () => {
    it.each([
        {
            label: 'claim database failure',
            input: { claim: null, errorType: 'database-error' },
            expected: { kind: 'claim_failed' },
        },
        {
            label: 'backend incompatibility',
            input: { claim: null, errorType: 'backend-incompatible' },
            expected: { kind: 'backend_incompatible' },
        },
        {
            label: 'idle queue',
            input: { claim: null },
            expected: { kind: 'idle' },
        },
        {
            label: 'invalid authority quarantined by Convex',
            input: { claim: { kind: 'authority_invalid' as const } },
            expected: { kind: 'progressed' },
        },
        {
            label: 'current protocol is executable',
            input: {
                claim: {
                    kind: 'claimed' as const,
                    run: {
                        appliedSteps: 0,
                        guildId: 'guild-1',
                        id: 'run-1',
                        protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
                        status: 'running',
                    },
                },
            },
            expected: { kind: 'execute' },
        },
    ])('$label', ({ input, expected }) => {
        expect(decideBlueprintClaim(input)).toMatchObject(expected);
    });

    it('fails a claimed incompatible protocol closed before execution', () => {
        expect(
            decideBlueprintClaim({
                claim: {
                    kind: 'claimed',
                    run: {
                        appliedSteps: 1,
                        guildId: 'guild-1',
                        id: 'run-1',
                        protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION + 1,
                        status: 'running',
                    },
                },
            })
        ).toStrictEqual({
            kind: 'protocol_mismatch',
            mismatch: {
                guildId: 'guild-1',
                kind: 'protocol_mismatch',
                mayHaveExternalEffects: true,
                requiredProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
                runId: 'run-1',
                runProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION + 1,
                status: 'running',
            },
        });
    });

    it.each([
        {
            label: 'applied mutation',
            result: { status: 'applied' as const },
            appliedSteps: 0,
            expected: { type: 'applied', requestedStatus: 'running', appliedStepsDelta: 1 },
        },
        {
            label: 'rate limit',
            result: { status: 'failed' as const, errorType: 'rate-limited' },
            appliedSteps: 0,
            expected: { type: 'rate_limited', requestedStatus: 'waiting_rate_limit', retryAfterMs: 60_000 },
        },
        {
            label: 'provider failure before any mutation',
            result: { status: 'failed' as const, errorType: 'provider-failed' },
            appliedSteps: 0,
            expected: { type: 'hard_failure', requestedStatus: 'failed_before_mutation', failedStepsDelta: 1 },
        },
        {
            label: 'provider failure after mutation',
            result: { status: 'failed' as const, errorType: 'provider-failed' },
            appliedSteps: 1,
            expected: { type: 'hard_failure', requestedStatus: 'partially_applied', failedStepsDelta: 1 },
        },
        {
            label: 'unknown provider outcome',
            result: {
                status: 'failed' as const,
                errorType: 'transport-failed',
                mutationOutcome: 'unknown',
            },
            appliedSteps: 0,
            expected: { type: 'outcome_unknown', requestedStatus: 'outcome_unknown', state: 'unknown' },
        },
        {
            label: 'lost lease',
            result: { status: 'failed' as const, errorType: 'apply-lease-lost' },
            appliedSteps: 0,
            expected: { type: 'lease_lost', requestedStatus: 'running' },
        },
    ])('$label', ({ result, appliedSteps, expected }) => {
        expect(
            decideProviderAction({
                actionResult: result,
                appliedSteps,
                controlStatus: 'running',
                targetType: 'role',
            })
        ).toMatchObject(expected);
    });

    it.each([
        {
            label: 'pause',
            state: createPostApplyState({ controlStatus: 'pause_requested' }),
            expected: { kind: 'checkpoint_paused' },
        },
        {
            label: 'cancel',
            state: createPostApplyState({ controlRequest: 'cancel', controlStatus: 'pause_requested' }),
            expected: { kind: 'terminal', status: 'cancelled' },
        },
        {
            label: 'persistence failure before mutation',
            state: createPostApplyState({ persistenceFailure: 'attempt-prepare-failed' }),
            expected: {
                errorType: 'attempt-prepare-failed',
                kind: 'terminal',
                status: 'failed_before_mutation',
            },
        },
        {
            label: 'persistence failure after mutation',
            state: createPostApplyState({
                knownPartialMutation: true,
                persistenceFailure: 'attempt-not-completed',
            }),
            expected: { kind: 'terminal', status: 'partially_applied' },
        },
        {
            label: 'successful application',
            state: createPostApplyState(),
            expected: { kind: 'verify' },
        },
    ])('$label', ({ state, expected }) => {
        expect(
            decideBlueprintPostApply({
                failedSteps: 0,
                nextStepSequence: 2,
                providerSucceeded: true,
                state,
                totalSteps: 2,
            })
        ).toMatchObject(expected);
    });

    it('selects success only for matched verification and reconciliation otherwise', () => {
        expect(finalStatusForVerification('matched')).toBe('succeeded');
        expect(finalStatusForVerification('mismatch')).toBe('needs_reconciliation');
        expect(finalStatusForVerification('read_failed')).toBe('needs_reconciliation');
    });

    it('keeps status, phase, retry, and mutation-fence policies explicit', () => {
        expect(terminalStatusForAppliedSteps(0)).toBe('failed_before_mutation');
        expect(terminalStatusForAppliedSteps(1)).toBe('partially_applied');
        expect(phaseForProviderStep('update', 'role-order')).toBe('role_order');
        expect(phaseForProviderStep('create', 'role')).toBe('create');
        expect(mutationFenceConstructionError(new Error('blueprint-mutation-fence-manifest-too-large'))).toBe(
            'mutation-fence-manifest-too-large'
        );
    });
});

function createPostApplyState(
    overrides: Partial<Parameters<typeof decideBlueprintPostApply>[0]['state']> = {}
): Parameters<typeof decideBlueprintPostApply>[0]['state'] {
    return {
        atomicCompletionFailed: false,
        controlRequest: null,
        controlStatus: 'running',
        knownPartialMutation: false,
        leaseActive: true,
        outcomeUnknown: false,
        rateLimited: false,
        terminalPersisted: false,
        ...overrides,
    };
}
