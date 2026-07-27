import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '@neonflux/blueprint';
import type { BlueprintRunPhase, BlueprintRunProtocolMismatchRecord, BlueprintRunStatus } from '@neonflux/db';

type ClaimCandidate =
    | null
    | BlueprintRunProtocolMismatchRecord
    | { kind: 'authority_invalid' }
    | {
          kind: 'claimed';
          run: {
              appliedSteps: number;
              guildId: string;
              id: string;
              protocolVersion: number;
              status: string;
          };
      };

export type BlueprintClaimDecision =
    | { kind: 'idle' }
    | { kind: 'progressed' }
    | { kind: 'backend_incompatible' }
    | { kind: 'claim_failed' }
    | { kind: 'protocol_mismatch'; mismatch: BlueprintRunProtocolMismatchRecord }
    | { kind: 'execute' };

export function decideBlueprintClaim(input: { claim: ClaimCandidate; errorType?: string }): BlueprintClaimDecision {
    if (input.errorType) {
        return input.errorType === 'backend-incompatible' ? { kind: 'backend_incompatible' } : { kind: 'claim_failed' };
    }
    if (!input.claim) return { kind: 'idle' };
    if (input.claim.kind === 'protocol_mismatch') {
        return { kind: 'protocol_mismatch', mismatch: input.claim };
    }
    if (input.claim.kind === 'authority_invalid') return { kind: 'progressed' };
    if (input.claim.run.protocolVersion === BLUEPRINT_RUN_PROTOCOL_VERSION) return { kind: 'execute' };

    return {
        kind: 'protocol_mismatch',
        mismatch: {
            guildId: input.claim.run.guildId,
            kind: 'protocol_mismatch',
            mayHaveExternalEffects: input.claim.run.appliedSteps > 0,
            requiredProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
            runId: input.claim.run.id,
            runProtocolVersion: input.claim.run.protocolVersion,
            status: input.claim.run.status,
        },
    };
}

export function terminalStatusForAppliedSteps(
    appliedSteps: number
): Extract<BlueprintRunStatus, 'partially_applied' | 'failed_before_mutation'> {
    return appliedSteps > 0 ? 'partially_applied' : 'failed_before_mutation';
}

type ProviderActionResult = {
    errorType?: string;
    mutationOutcome?: string;
    retryAfterMs?: number;
    status: 'applied' | 'failed';
};

export type ProviderActionDecision = {
    appliedStepsDelta: 0 | 1;
    completedMutationStepsDelta: 0 | 1;
    errorType?: string;
    failedStepsDelta: 0 | 1;
    knownPartialMutation: boolean;
    nextStepSequenceDelta: 0 | 1;
    requestedStatus:
        | 'running'
        | 'pause_requested'
        | 'waiting_rate_limit'
        | 'partially_applied'
        | 'failed_before_mutation'
        | 'outcome_unknown';
    retryAfterMs?: number;
    state: 'applied' | 'failed' | 'unknown';
    type: 'applied' | 'hard_failure' | 'lease_lost' | 'outcome_unknown' | 'rate_limited';
};

export function decideProviderAction(input: {
    actionResult: ProviderActionResult;
    appliedSteps: number;
    controlStatus: string;
    targetType?: string;
}): ProviderActionDecision {
    const { actionResult } = input;
    const rateLimited = actionResult.errorType === 'rate-limited';
    const leaseLost = actionResult.errorType === 'apply-lease-lost';
    const outcomeUnknown = actionResult.status === 'failed' && actionResult.mutationOutcome === 'unknown';

    if (actionResult.status === 'applied') {
        return {
            appliedStepsDelta: 1,
            completedMutationStepsDelta: 1,
            failedStepsDelta: 0,
            knownPartialMutation: true,
            nextStepSequenceDelta: 1,
            requestedStatus: input.controlStatus === 'pause_requested' ? 'pause_requested' : 'running',
            state: 'applied',
            type: 'applied',
        };
    }
    if (outcomeUnknown) {
        return {
            appliedStepsDelta: 0,
            completedMutationStepsDelta: 0,
            errorType: `mutation-outcome-unknown:${actionResult.errorType ?? 'operation-failed'}`,
            failedStepsDelta: 0,
            knownPartialMutation: input.appliedSteps > 0,
            nextStepSequenceDelta: 0,
            requestedStatus: 'outcome_unknown',
            state: 'unknown',
            type: 'outcome_unknown',
        };
    }
    if (rateLimited) {
        return {
            appliedStepsDelta: 0,
            completedMutationStepsDelta: 0,
            ...(actionResult.errorType ? { errorType: actionResult.errorType } : {}),
            failedStepsDelta: 0,
            knownPartialMutation: input.appliedSteps > 0,
            nextStepSequenceDelta: 0,
            requestedStatus: 'waiting_rate_limit',
            retryAfterMs: actionResult.retryAfterMs ?? fallbackRetryAfterMs(input.targetType),
            state: 'failed',
            type: 'rate_limited',
        };
    }
    if (leaseLost) {
        return {
            appliedStepsDelta: 0,
            completedMutationStepsDelta: 0,
            ...(actionResult.errorType ? { errorType: actionResult.errorType } : {}),
            failedStepsDelta: 0,
            knownPartialMutation: input.appliedSteps > 0,
            nextStepSequenceDelta: 0,
            requestedStatus: input.controlStatus === 'pause_requested' ? 'pause_requested' : 'running',
            state: 'failed',
            type: 'lease_lost',
        };
    }

    return {
        appliedStepsDelta: 0,
        completedMutationStepsDelta: 0,
        ...(actionResult.errorType ? { errorType: actionResult.errorType } : {}),
        failedStepsDelta: 1,
        knownPartialMutation: input.appliedSteps > 0,
        nextStepSequenceDelta: 1,
        requestedStatus: terminalStatusForAppliedSteps(input.appliedSteps),
        state: 'failed',
        type: 'hard_failure',
    };
}

type PostApplyState = {
    atomicCompletionFailed: boolean;
    controlRequest: 'pause' | 'cancel' | null;
    controlStatus: string;
    knownPartialMutation: boolean;
    leaseActive: boolean;
    outcomeUnknown: boolean;
    persistenceFailure?: string;
    rateLimited: boolean;
    terminalPersisted: boolean;
};

export type BlueprintPostApplyDecision =
    | { kind: 'progressed' }
    | { kind: 'checkpoint_paused' }
    | {
          errorType?: string;
          kind: 'terminal';
          status: 'cancelled' | 'outcome_unknown' | 'partially_applied' | 'failed_before_mutation';
      }
    | { kind: 'verify' };

export function decideBlueprintPostApply(input: {
    failedSteps: number;
    nextStepSequence: number;
    providerErrorType?: string;
    providerFailedActionErrorType?: string;
    providerSucceeded: boolean;
    state: PostApplyState;
    totalSteps: number;
}): BlueprintPostApplyDecision {
    const { state } = input;
    if (
        state.terminalPersisted ||
        state.controlStatus === 'cancelled' ||
        state.controlStatus === 'paused' ||
        state.atomicCompletionFailed
    ) {
        return { kind: 'progressed' };
    }
    if (state.outcomeUnknown) {
        return {
            errorType: 'mutation-result-persistence-failed',
            kind: 'terminal',
            status: 'outcome_unknown',
        };
    }
    if (state.persistenceFailure) {
        return {
            errorType: state.persistenceFailure,
            kind: 'terminal',
            status: terminalStatusForAppliedSteps(state.knownPartialMutation ? 1 : 0),
        };
    }
    if (state.controlStatus === 'pause_requested') {
        return state.controlRequest === 'cancel'
            ? { kind: 'terminal', status: 'cancelled' }
            : { kind: 'checkpoint_paused' };
    }
    if (state.rateLimited) return { kind: 'progressed' };
    if (!input.providerSucceeded || !state.leaseActive) {
        return {
            errorType: input.providerErrorType ?? 'run-control-requested',
            kind: 'terminal',
            status: terminalStatusForAppliedSteps(state.knownPartialMutation ? 1 : 0),
        };
    }
    if (input.providerFailedActionErrorType || input.nextStepSequence !== input.totalSteps || input.failedSteps > 0) {
        return {
            errorType: input.providerFailedActionErrorType ?? 'blueprint-run-incomplete',
            kind: 'terminal',
            status: terminalStatusForAppliedSteps(state.knownPartialMutation ? 1 : 0),
        };
    }
    return { kind: 'verify' };
}

export function finalStatusForVerification(
    status: 'matched' | 'mismatch' | 'read_failed'
): Extract<BlueprintRunStatus, 'succeeded' | 'needs_reconciliation'> {
    return status === 'matched' ? 'succeeded' : 'needs_reconciliation';
}

export function phaseForProviderStep(
    actionType: string | undefined,
    targetType: string | undefined
): Extract<BlueprintRunPhase, 'preparing' | 'create' | 'update' | 'delete' | 'channel_order' | 'role_order'> {
    if (targetType === 'channel-order') return 'channel_order';
    if (targetType === 'role-order') return 'role_order';
    return actionType === 'create' || actionType === 'update' || actionType === 'delete' ? actionType : 'preparing';
}

export function mutationFenceConstructionError(error: unknown): string {
    return error instanceof Error && error.message === 'blueprint-mutation-fence-manifest-too-large'
        ? 'mutation-fence-manifest-too-large'
        : 'pre-mutation-observation-invalid';
}

function fallbackRetryAfterMs(targetType: string | undefined): number {
    return targetType === 'role' || targetType === 'role-order' ? 60_000 : 10_000;
}
