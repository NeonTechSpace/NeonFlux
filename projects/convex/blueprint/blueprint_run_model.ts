export function classifyBlueprintRunReclaim(input: {
    hasStartedAttempt: boolean;
    leaseExpiresAt?: string;
    now: string;
}): 'active' | 'outcome_unknown' | 'reclaim' {
    if (!input.leaseExpiresAt || input.leaseExpiresAt > input.now) return 'active';
    return input.hasStartedAttempt ? 'outcome_unknown' : 'reclaim';
}

export function isBlueprintRunMutationAuthorizedForLease(input: {
    completedMutationSteps: number;
    expiresAt: string;
    leaseId: string;
    mutationAuthorizedAt?: string;
    mutationAuthorizationLeaseId?: string;
    nextStepSequence: number;
    now: string;
}): boolean {
    if (input.nextStepSequence > 0 || input.completedMutationSteps > 0) return true;
    return (
        input.expiresAt > input.now &&
        Boolean(input.mutationAuthorizedAt) &&
        input.mutationAuthorizationLeaseId === input.leaseId
    );
}

export function isBlueprintRunRetryPreflightFresh(input: {
    latestRun?: { status: string; updatedAt: string } | null;
    preflightCheckedAt: string;
}): boolean {
    return input.latestRun?.status !== 'failed_before_mutation' || input.preflightCheckedAt > input.latestRun.updatedAt;
}

export type BlueprintRunAuthorizationDecision =
    | 'structure_changed'
    | 'capability_changed'
    | 'structure_and_capability_changed'
    | 'restore_observation_diverged'
    | 'preflight_expired'
    | 'fingerprint_version_mismatch';

export function resolveBlueprintRunAuthorizationDecision(input: {
    capabilityChanged: boolean;
    fingerprintVersionsCurrent: boolean;
    now: string;
    preflightExpiresAt: string;
    restoreObservationEqual: boolean;
    structureChanged: boolean;
}): BlueprintRunAuthorizationDecision | undefined {
    if (!input.fingerprintVersionsCurrent) return 'fingerprint_version_mismatch';
    if (input.preflightExpiresAt <= input.now) return 'preflight_expired';
    if (!input.restoreObservationEqual) return 'restore_observation_diverged';
    if (input.structureChanged && input.capabilityChanged) return 'structure_and_capability_changed';
    if (input.structureChanged) return 'structure_changed';
    if (input.capabilityChanged) return 'capability_changed';
    return undefined;
}

export function resolveExpiredBlueprintRunControl(controlRequest: unknown): 'paused' | 'cancelled' {
    return controlRequest === 'cancel' ? 'cancelled' : 'paused';
}

export function resolveBlueprintRunStepAttemptCompletionStatus(input: {
    controlRequest: unknown;
    runStatus: string;
    requestedStatus:
        | 'running'
        | 'pause_requested'
        | 'waiting_rate_limit'
        | 'partially_applied'
        | 'failed_before_mutation'
        | 'outcome_unknown';
}):
    | 'running'
    | 'pause_requested'
    | 'waiting_rate_limit'
    | 'partially_applied'
    | 'failed_before_mutation'
    | 'outcome_unknown'
    | 'paused'
    | 'cancelled' {
    const requestedTerminal =
        input.requestedStatus === 'partially_applied' ||
        input.requestedStatus === 'failed_before_mutation' ||
        input.requestedStatus === 'outcome_unknown';
    if (requestedTerminal || input.runStatus !== 'pause_requested') return input.requestedStatus;
    return input.controlRequest === 'cancel' ? 'cancelled' : 'paused';
}

export function resolveBlueprintRunReferenceAuthority(authority: unknown): {
    idMap: Record<string, string>;
    knownTargetKinds: Record<string, 'role' | 'category' | 'channel'>;
} {
    const authorityRecord = normalizeRecord(authority);
    const sourceTargetMap = normalizeRecord(authorityRecord?.sourceTargetMap);
    const knownTargetKinds = normalizeRecord(authorityRecord?.knownTargetKinds);
    const initialIdMap = normalizeBlueprintRunIdMap(authorityRecord?.initialIdMap);
    if (!sourceTargetMap) throw new Error('blueprint-plan-source-target-map-invalid');
    if (!knownTargetKinds) throw new Error('blueprint-plan-known-target-kinds-invalid');

    const resolved: Record<string, string> = {};
    const resolvedTargetIds = new Set<string>();
    for (const [sourceIdValue, targetIdValue] of Object.entries(sourceTargetMap)) {
        const sourceId = sourceIdValue.trim();
        if (!sourceId || sourceId !== sourceIdValue) {
            throw new Error('blueprint-plan-source-target-map-invalid');
        }
        if (targetIdValue === null) continue;
        if (typeof targetIdValue !== 'string' || !targetIdValue.trim() || targetIdValue !== targetIdValue.trim()) {
            throw new Error('blueprint-plan-source-target-map-invalid');
        }
        if (resolvedTargetIds.has(targetIdValue)) throw new Error('blueprint-plan-source-target-map-invalid');
        resolved[sourceId] = targetIdValue;
        resolvedTargetIds.add(targetIdValue);
    }

    const knownTargetIdSet = new Set(Object.keys(knownTargetKinds));
    if (Object.values(resolved).some((targetId) => !knownTargetIdSet.has(targetId))) {
        throw new Error('blueprint-plan-source-target-map-invalid');
    }

    const normalizedTargetKinds: Record<string, 'role' | 'category' | 'channel'> = {};
    for (const [id, kind] of Object.entries(knownTargetKinds)) {
        if (!id.trim() || id !== id.trim() || (kind !== 'role' && kind !== 'category' && kind !== 'channel')) {
            throw new Error('blueprint-plan-known-target-kinds-invalid');
        }
        normalizedTargetKinds[id] = kind;
    }
    const targetIds = Object.keys(normalizedTargetKinds);
    if (
        !targetIds.every((id, index) => [...targetIds].sort((left, right) => left.localeCompare(right))[index] === id)
    ) {
        throw new Error('blueprint-plan-known-target-kinds-invalid');
    }

    if (stableJson(initialIdMap) !== stableJson(resolved)) {
        throw new Error('blueprint-plan-initial-id-map-invalid');
    }

    return {
        idMap: initialIdMap,
        knownTargetKinds: normalizedTargetKinds,
    };
}

export function resolveBlueprintRunIdMap(authority: unknown): Record<string, string> {
    return resolveBlueprintRunReferenceAuthority(authority).idMap;
}

export function validateBlueprintRunIdMapTransition(input: {
    authority: unknown;
    next: unknown;
    previous: unknown;
}): Record<string, string> {
    const sourceTargetMap = normalizeRecord(normalizeRecord(input.authority)?.sourceTargetMap);
    const previous = normalizeBlueprintRunIdMap(input.previous);
    const next = normalizeBlueprintRunIdMap(input.next);
    const initial = resolveBlueprintRunIdMap(input.authority);
    if (!sourceTargetMap) throw new Error('blueprint-plan-source-target-map-invalid');

    for (const sourceId of Object.keys(initial)) {
        if (!Object.hasOwn(previous, sourceId) || !Object.hasOwn(next, sourceId)) {
            throw new Error('blueprint-run-id-map-conflict');
        }
    }
    validateBlueprintRunIdMapEntries(previous, sourceTargetMap);
    for (const [sourceId, targetId] of Object.entries(previous)) {
        if (next[sourceId] !== targetId) throw new Error('blueprint-run-id-map-regression');
    }
    validateBlueprintRunIdMapEntries(next, sourceTargetMap);

    return next;
}

function validateBlueprintRunIdMapEntries(
    idMap: Record<string, string>,
    sourceTargetMap: Record<string, unknown>
): void {
    const targetIds = new Set<string>();
    for (const [sourceId, targetId] of Object.entries(idMap)) {
        if (!Object.hasOwn(sourceTargetMap, sourceId)) throw new Error('blueprint-run-id-map-unknown-source');
        if (targetIds.has(targetId)) throw new Error('blueprint-run-id-map-conflict');
        targetIds.add(targetId);
    }
}

export function validateBlueprintRunCheckpointIdMap(input: {
    authority: unknown;
    next: unknown;
    previous: unknown;
}): Record<string, string> {
    const previous = normalizeBlueprintRunIdMap(input.previous);
    const next = validateBlueprintRunIdMapTransition(input);
    if (stableJson(previous) !== stableJson(next)) throw new Error('blueprint-run-id-map-checkpoint-change');
    return next;
}

export function validateBlueprintRunAttemptIdMapTransition(input: {
    planStep: { actionType: string; targetId?: string };
    attemptState: string;
    createdId?: string;
    next: unknown;
    authority: unknown;
    previous: unknown;
    resultState: 'applied' | 'failed' | 'unknown';
}): Record<string, string> {
    const previous = normalizeBlueprintRunIdMap(input.previous);
    validateBlueprintRunIdMapTransition({ ...input, next: previous, previous });
    const next = normalizeBlueprintRunIdMap(input.next);
    if (
        input.attemptState === 'started' &&
        input.resultState === 'applied' &&
        input.planStep.actionType === 'create' &&
        typeof input.planStep.targetId === 'string' &&
        input.planStep.targetId.length > 0 &&
        typeof input.createdId === 'string' &&
        input.createdId.length > 0
    ) {
        const sourceTargetMap = normalizeRecord(normalizeRecord(input.authority)?.sourceTargetMap);
        const knownTargetKinds = resolveBlueprintRunReferenceAuthority(input.authority).knownTargetKinds;
        const changedSources = new Set([...Object.keys(previous), ...Object.keys(next)]);
        for (const sourceId of [...changedSources]) {
            if (previous[sourceId] === next[sourceId]) changedSources.delete(sourceId);
        }
        const targetIds = Object.values(next);
        if (
            !sourceTargetMap ||
            !Object.hasOwn(sourceTargetMap, input.planStep.targetId) ||
            changedSources.size !== 1 ||
            !changedSources.has(input.planStep.targetId) ||
            next[input.planStep.targetId] !== input.createdId ||
            previous[input.planStep.targetId] === input.createdId ||
            Object.hasOwn(knownTargetKinds, input.createdId) ||
            new Set(targetIds).size !== targetIds.length
        ) {
            throw new Error('blueprint-run-create-id-map-invalid');
        }
        return next;
    }
    validateBlueprintRunIdMapTransition({ ...input, next, previous });
    if (input.createdId !== undefined || stableJson(previous) !== stableJson(next)) {
        throw new Error('blueprint-run-id-map-attempt-change');
    }
    return next;
}

export function validateBlueprintRunAttemptIndexedMappingDelta(input: {
    planStep: { actionType?: string; targetId?: string };
    attemptState: 'pending' | 'started' | 'applied' | 'failed' | 'unknown';
    resultState: 'applied' | 'failed' | 'unknown';
    createdId?: string;
    sourceMappingPresent: boolean;
    sourceTargetId: string | null | undefined;
    createdTargetKnown: boolean;
}): { sourceId: string; targetId: string } | null {
    const isAppliedCreate = input.planStep.actionType === 'create' && input.resultState === 'applied';
    if (!isAppliedCreate) {
        if (input.createdId !== undefined) throw new Error('blueprint-run-id-map-attempt-change');
        return null;
    }
    const sourceId = input.planStep.targetId;
    const targetId = input.createdId;
    if (
        input.attemptState !== 'started' ||
        !sourceId ||
        !targetId ||
        !input.sourceMappingPresent ||
        input.sourceTargetId !== null ||
        input.createdTargetKnown
    ) {
        throw new Error('blueprint-run-create-id-map-invalid');
    }
    return { sourceId, targetId };
}

export function validateBlueprintRunProgressTransition(input: {
    next: {
        appliedSteps: number;
        completedMutationSteps: number;
        failedSteps: number;
        nextStepSequence: number;
        notStartedSteps: number;
        skippedSteps: number;
        totalMutationSteps: number;
    };
    previous: {
        appliedSteps: number;
        completedMutationSteps: number;
        failedSteps: number;
        nextStepSequence: number;
        skippedSteps: number;
        totalSteps: number;
        totalMutationSteps: number;
    };
}): void {
    const { next, previous } = input;
    if (
        [
            next.appliedSteps,
            next.completedMutationSteps,
            next.failedSteps,
            next.nextStepSequence,
            next.notStartedSteps,
            next.skippedSteps,
            next.totalMutationSteps,
        ].some((value) => !Number.isInteger(value) || value < 0) ||
        next.nextStepSequence > previous.totalSteps ||
        next.completedMutationSteps > next.totalMutationSteps ||
        next.totalMutationSteps !== previous.totalMutationSteps ||
        previous.totalMutationSteps !== previous.totalSteps ||
        next.completedMutationSteps !== next.appliedSteps ||
        next.appliedSteps + next.failedSteps + next.skippedSteps !== next.nextStepSequence ||
        next.notStartedSteps !== previous.totalSteps - next.nextStepSequence
    ) {
        throw new Error('blueprint-run-progress-invalid');
    }
    if (
        next.appliedSteps < previous.appliedSteps ||
        next.completedMutationSteps < previous.completedMutationSteps ||
        next.failedSteps < previous.failedSteps ||
        next.nextStepSequence < previous.nextStepSequence ||
        next.skippedSteps < previous.skippedSteps
    ) {
        throw new Error('blueprint-run-progress-regression');
    }
}

export function validateBlueprintRunStepAttemptCompletionTransition(input: {
    attempt: { state: 'pending' | 'started' | 'applied' | 'failed' | 'unknown' };
    args: {
        appliedSteps: number;
        completedMutationSteps: number;
        failedSteps: number;
        nextStepSequence: number;
        retryAt?: string;
        skippedSteps: number;
        state: 'applied' | 'failed' | 'unknown';
        status:
            | 'running'
            | 'pause_requested'
            | 'waiting_rate_limit'
            | 'partially_applied'
            | 'failed_before_mutation'
            | 'outcome_unknown';
    };
    run: {
        appliedSteps: number;
        completedMutationSteps: number;
        failedSteps: number;
        nextStepSequence: number;
        skippedSteps: number;
    };
}): void {
    const { args, attempt, run } = input;
    const unchanged =
        args.appliedSteps === run.appliedSteps &&
        args.completedMutationSteps === run.completedMutationSteps &&
        args.failedSteps === run.failedSteps &&
        args.nextStepSequence === run.nextStepSequence &&
        args.skippedSteps === run.skippedSteps;
    const applied =
        attempt.state === 'started' &&
        args.state === 'applied' &&
        args.appliedSteps === run.appliedSteps + 1 &&
        args.completedMutationSteps === run.completedMutationSteps + 1 &&
        args.failedSteps === run.failedSteps &&
        args.nextStepSequence === run.nextStepSequence + 1 &&
        args.skippedSteps === run.skippedSteps;
    const hardFailure =
        args.state === 'failed' &&
        (args.status === 'partially_applied' || args.status === 'failed_before_mutation') &&
        args.appliedSteps === run.appliedSteps &&
        args.completedMutationSteps === run.completedMutationSteps &&
        args.failedSteps === run.failedSteps + 1 &&
        args.nextStepSequence === run.nextStepSequence + 1 &&
        args.skippedSteps === run.skippedSteps;
    const retryableFailure =
        args.state === 'failed' &&
        args.status === 'waiting_rate_limit' &&
        typeof args.retryAt === 'string' &&
        unchanged;
    const nonMutatingFailure =
        args.state === 'failed' && (args.status === 'running' || args.status === 'pause_requested') && unchanged;
    const unknown =
        attempt.state === 'started' && args.state === 'unknown' && args.status === 'outcome_unknown' && unchanged;
    if (!applied && !hardFailure && !retryableFailure && !nonMutatingFailure && !unknown) {
        throw new Error('blueprint-run-attempt-progress-invalid');
    }
}

export function resolveBlueprintRunStepAttemptCompletionRetry(input: {
    attemptState: 'pending' | 'started' | 'applied' | 'failed' | 'unknown';
    completionDigest?: string;
    incomingDigest: string;
}): 'continue' | 'return_committed' {
    if (input.attemptState === 'pending' || input.attemptState === 'started') return 'continue';
    if (input.completionDigest === input.incomingDigest) return 'return_committed';
    throw new Error('blueprint-run-step-attempt-completion-conflict');
}

export function selectBlueprintRunClaimAttempt<T extends { attempt: number; state: string }>(
    attempts: readonly T[]
): T | null {
    if (attempts.length === 0) return null;
    if (attempts.length > 10) throw new Error('blueprint-run-step-attempt-history-invalid');

    const attemptNumbers = new Set<number>();
    let latest: T | undefined;
    let pending: T | undefined;
    for (const attempt of attempts) {
        if (
            !Number.isSafeInteger(attempt.attempt) ||
            attempt.attempt < 1 ||
            attempt.attempt > 10 ||
            attemptNumbers.has(attempt.attempt) ||
            !['pending', 'failed'].includes(attempt.state)
        ) {
            throw new Error('blueprint-run-step-attempt-history-invalid');
        }
        attemptNumbers.add(attempt.attempt);
        if (!latest || attempt.attempt > latest.attempt) latest = attempt;
        if (attempt.state === 'pending') {
            if (pending) throw new Error('blueprint-run-pending-attempt-conflict');
            pending = attempt;
        }
    }
    if (pending && pending.attempt !== latest?.attempt) {
        throw new Error('blueprint-run-pending-attempt-conflict');
    }
    return pending ?? latest ?? null;
}

function stableJson(value: unknown): string {
    return JSON.stringify(canonicalJsonValue(value));
}

function canonicalJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalJsonValue);
    const record = normalizeRecord(value);
    if (!record) return value;
    return Object.fromEntries(
        Object.entries(record)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, canonicalJsonValue(item)])
    );
}

function normalizeBlueprintRunIdMap(value: unknown): Record<string, string> {
    const record = normalizeRecord(value);
    if (!record) throw new Error('blueprint-run-id-map-invalid');

    const normalized: Record<string, string> = {};
    for (const [sourceIdValue, targetIdValue] of Object.entries(record)) {
        const sourceId = sourceIdValue.trim();
        if (
            !sourceId ||
            sourceId !== sourceIdValue ||
            typeof targetIdValue !== 'string' ||
            !targetIdValue.trim() ||
            targetIdValue !== targetIdValue.trim()
        ) {
            throw new Error('blueprint-run-id-map-invalid');
        }
        normalized[sourceId] = targetIdValue;
    }
    return normalized;
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}
