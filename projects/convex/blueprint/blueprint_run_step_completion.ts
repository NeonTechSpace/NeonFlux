import { resolveBlueprintRunStepAttemptCompletionStatus } from './blueprint_run_model.js';

type CompletionPhase =
    | 'preparing'
    | 'create'
    | 'update'
    | 'delete'
    | 'channel_order'
    | 'role_order'
    | 'waiting_rate_limit'
    | 'complete';
type RequestedCompletionStatus =
    | 'running'
    | 'pause_requested'
    | 'waiting_rate_limit'
    | 'partially_applied'
    | 'failed_before_mutation'
    | 'outcome_unknown';
type ResolvedCompletionStatus = RequestedCompletionStatus | 'paused' | 'cancelled';
type TerminalCompletionStatus = 'partially_applied' | 'failed_before_mutation' | 'outcome_unknown' | 'cancelled';

export type BlueprintRunStepCompletionInput = {
    appliedSteps: number;
    completedMutationSteps: number;
    createdId?: string;
    currentStepDomain?: string;
    currentStepId?: string;
    currentStepLabel?: string;
    errorType?: string;
    failedSteps: number;
    nextStepSequence: number;
    notStartedSteps: number;
    now: string;
    phase: CompletionPhase;
    retryAt?: string;
    skippedSteps: number;
    state: 'applied' | 'failed' | 'unknown';
    status: RequestedCompletionStatus;
};

type BlueprintRunStepCompletionDecisionBase = {
    auditAction?: 'blueprint.run_paused';
    releaseLease: boolean;
    resolvedPhase: Exclude<CompletionPhase, 'complete'> | 'paused' | 'complete';
};
export type BlueprintRunStepCompletionDecision =
    | (BlueprintRunStepCompletionDecisionBase & {
          resolvedStatus: TerminalCompletionStatus;
          terminal: true;
      })
    | (BlueprintRunStepCompletionDecisionBase & {
          resolvedStatus: Exclude<ResolvedCompletionStatus, TerminalCompletionStatus>;
          terminal: false;
      });

export function decideBlueprintRunStepCompletion(input: {
    completion: BlueprintRunStepCompletionInput;
    run: {
        controlRequest?: 'pause' | 'cancel';
        status: string;
    };
}): BlueprintRunStepCompletionDecision {
    const { completion, run } = input;
    const requestedTerminal =
        completion.status === 'partially_applied' ||
        completion.status === 'failed_before_mutation' ||
        completion.status === 'outcome_unknown';

    if (
        (completion.status === 'waiting_rate_limit' &&
            (completion.state !== 'failed' || !completion.retryAt || completion.phase !== 'waiting_rate_limit')) ||
        (completion.status === 'outcome_unknown' &&
            (completion.state !== 'unknown' || completion.phase !== 'complete')) ||
        ((completion.status === 'partially_applied' || completion.status === 'failed_before_mutation') &&
            (completion.state !== 'failed' || completion.phase !== 'complete' || !completion.errorType)) ||
        (completion.status === 'failed_before_mutation' &&
            (completion.appliedSteps !== 0 || completion.completedMutationSteps !== 0)) ||
        (completion.status === 'partially_applied' && completion.appliedSteps === 0) ||
        (!requestedTerminal && completion.phase === 'complete')
    ) {
        throw new Error('blueprint-run-attempt-outcome-invalid');
    }

    const resolvedStatus = resolveBlueprintRunStepAttemptCompletionStatus({
        controlRequest: run.controlRequest,
        runStatus: run.status,
        requestedStatus: completion.status,
    });
    const controlStatus = resolvedStatus === 'paused' || resolvedStatus === 'cancelled' ? resolvedStatus : undefined;
    const resolvedPhase =
        controlStatus === 'paused' ? ('paused' as const) : controlStatus ? ('complete' as const) : completion.phase;
    const terminal =
        resolvedStatus === 'partially_applied' ||
        resolvedStatus === 'failed_before_mutation' ||
        resolvedStatus === 'outcome_unknown' ||
        resolvedStatus === 'cancelled';
    const releaseLease = resolvedStatus === 'waiting_rate_limit' || resolvedStatus === 'paused';

    const decisionBase = {
        ...(resolvedStatus === 'paused' ? { auditAction: 'blueprint.run_paused' as const } : {}),
        releaseLease,
        resolvedPhase,
    };

    return terminal
        ? {
              ...decisionBase,
              resolvedStatus,
              terminal: true,
          }
        : {
              ...decisionBase,
              resolvedStatus,
              terminal: false,
          };
}

export function buildBlueprintRunStepCompletionPatches(input: {
    completion: BlueprintRunStepCompletionInput;
    completionDigest: string;
    currentMappingCount: number;
    decision: BlueprintRunStepCompletionDecision;
    mappingCreated: boolean;
}) {
    const { completion, decision } = input;
    const attemptPatch = {
        completedAt: completion.now,
        completionDigest: input.completionDigest,
        ...(completion.createdId ? { createdId: completion.createdId } : {}),
        ...(completion.errorType ? { errorType: completion.errorType } : {}),
        ...(completion.retryAt ? { retryAt: completion.retryAt } : {}),
        state: completion.state,
        updatedAt: completion.now,
    };
    const runPatch = {
        appliedSteps: completion.appliedSteps,
        completedMutationSteps: completion.completedMutationSteps,
        currentStepDomain: completion.currentStepDomain,
        currentStepId: completion.currentStepId,
        currentStepLabel: completion.currentStepLabel,
        failedSteps: completion.failedSteps,
        errorType:
            decision.resolvedStatus === 'paused' || decision.resolvedStatus === 'cancelled'
                ? undefined
                : completion.errorType,
        nextStepSequence: completion.nextStepSequence,
        notStartedSteps: completion.notStartedSteps,
        phase: decision.resolvedPhase,
        retryAt: decision.terminal || decision.resolvedStatus === 'paused' ? undefined : completion.retryAt,
        skippedSteps: completion.skippedSteps,
        status: decision.resolvedStatus,
        updatedAt: completion.now,
        ...(decision.releaseLease
            ? {
                  controlRequest: undefined,
                  heartbeatAt: undefined,
                  leaseExpiresAt: undefined,
                  leaseId: undefined,
                  leaseOwner: undefined,
              }
            : {}),
    };

    return {
        attemptPatch,
        cursorPatch: {
            mappingCount: input.currentMappingCount + (input.mappingCreated ? 1 : 0),
            updatedAt: completion.now,
        },
        runPatch,
    };
}
