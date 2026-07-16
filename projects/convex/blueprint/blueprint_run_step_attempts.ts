import { getDocumentSize, v, type Value } from 'convex/values';
import {
    getBlueprintPlanExecutionAuthorityBucket,
    validateBlueprintPlanExecutionAuthorityBucketIntegrity,
    validateBlueprintPlanExecutionAuthorityManifestIntegrity,
} from '@neonflux/blueprint/execution-authority';
import { sha256CanonicalJson } from '@neonflux/blueprint/integrity';
import type { BlueprintPlanExecutionAuthorityBucketV1 } from '@neonflux/blueprint/persisted-authority';

import type { Doc } from '../_generated/dataModel.js';
import { mutation, type MutationCtx } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { recordBlueprintAuditInMutation } from './blueprint_audit.js';
import { requireRunLease } from './blueprint_run_lease.js';
import { applyBlueprintRunPatch, patchBlueprintRunChecked } from './blueprint_run_persistence.js';
import {
    createBlueprintRunControlCancellationRequestDigest,
    finalizeBlueprintRunInMutation,
} from './blueprint_run_terminal_mutation.js';
import {
    resolveBlueprintRunStepAttemptCompletionStatus,
    isBlueprintRunMutationAuthorizedForLease,
    validateBlueprintRunAttemptIndexedMappingDelta,
    validateBlueprintRunProgressTransition,
    validateBlueprintRunStepAttemptCompletionTransition,
    resolveBlueprintRunStepAttemptCompletionRetry,
} from './blueprint_run_model.js';

const MAX_BLUEPRINT_RUN_STEP_ATTEMPTS = 10;
const MAX_BLUEPRINT_RUN_STEP_ATTEMPT_BYTES = 8 * 1024;
const MAX_BLUEPRINT_RUN_CURSOR_BYTES = 4 * 1024;
const MAX_BLUEPRINT_RUN_ID_MAPPING_BYTES = 1024;
const START_LEASE_RENEWAL_THRESHOLD_MS = 60_000;

export const prepareBlueprintRunStepAttempt = mutation({
    args: {
        planStepId: v.id('blueprintPlanSteps'),
        attempt: v.number(),
        runId: v.id('blueprintRuns'),
        leaseId: v.string(),
        leaseExpiresAt: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        requestKey: v.string(),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        assertBoundedText(args.requestKey, 512, 'blueprint-run-step-attempt-request-key-too-large');
        const run = await requireRunLease(ctx, args.runId, args.leaseId, args.leaseOwner, args.now, [
            'running',
            'pause_requested',
        ]);
        if (!Number.isInteger(args.attempt) || args.attempt < 1 || args.attempt > MAX_BLUEPRINT_RUN_STEP_ATTEMPTS)
            throw new Error('blueprint-run-step-attempt-number-invalid');
        const existing = await ctx.db
            .query('blueprintRunStepAttempts')
            .withIndex('by_run_plan_step_attempt', (q) =>
                q.eq('runId', args.runId).eq('planStepId', args.planStepId).eq('attempt', args.attempt)
            )
            .first();
        if (existing) {
            await assertAttemptProjectionIntegrity(existing);
            if (
                existing.requestKey !== args.requestKey ||
                existing.planStepSequence !== run.nextStepSequence ||
                existing.state !== 'pending'
            ) {
                throw new Error('blueprint-run-step-attempt-conflict');
            }
            const runPatch = prepareRunPatch(run, existing, args.now, args.leaseExpiresAt);
            await patchBlueprintRunChecked(ctx, run, runPatch);
            return {
                kind: run.status === 'pause_requested' ? ('control_requested' as const) : ('prepared' as const),
                attempt: { ...existing, id: existing._id },
                run: { ...run, ...runPatch, id: run._id },
            };
        }
        const planStep = await ctx.db.get('blueprintPlanSteps', args.planStepId);
        if (planStep?.planId !== run.planId || planStep.sequence !== run.nextStepSequence) {
            throw new Error('blueprint-run-step-attempt-plan-step-invalid');
        }
        const projection = await createAttemptProjection(args.planStepId, planStep.sequence, planStep.step);
        const document = {
            ...projection,
            planStepId: args.planStepId,
            attempt: args.attempt,
            createdAt: args.now,
            runId: args.runId,
            requestKey: args.requestKey,
            state: 'pending' as const,
            updatedAt: args.now,
        };
        assertDocumentSize(document, MAX_BLUEPRINT_RUN_STEP_ATTEMPT_BYTES, 'blueprint-run-step-attempt-too-large');
        const id = await ctx.db.insert('blueprintRunStepAttempts', document);
        const runPatch = prepareRunPatch(run, document, args.now, args.leaseExpiresAt);
        await patchBlueprintRunChecked(ctx, run, runPatch);
        return {
            kind: run.status === 'pause_requested' ? ('control_requested' as const) : ('prepared' as const),
            attempt: { id, ...document },
            run: { ...run, ...runPatch, id: run._id },
        };
    },
});

export const startBlueprintRunStepAttempt = mutation({
    args: {
        attemptId: v.id('blueprintRunStepAttempts'),
        leaseId: v.string(),
        leaseExpiresAt: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const attempt = await ctx.db.get('blueprintRunStepAttempts', args.attemptId);
        if (!attempt) throw new Error('blueprint-run-step-attempt-not-found');
        await assertAttemptProjectionIntegrity(attempt);
        const run = await requireRunLease(ctx, attempt.runId, args.leaseId, args.leaseOwner, args.now, [
            'running',
            'pause_requested',
        ]);
        if (attempt.state !== 'pending') throw new Error('blueprint-run-step-attempt-not-pending');
        if (attempt.planStepSequence !== run.nextStepSequence || String(attempt.planStepId) !== run.currentStepId) {
            throw new Error('blueprint-run-step-attempt-plan-step-invalid');
        }
        if (run.status === 'pause_requested') {
            return {
                kind: 'control_requested' as const,
                attempt: { ...attempt, id: attempt._id },
                run: { ...run, id: run._id },
            };
        }
        if (
            !isBlueprintRunMutationAuthorizedForLease({
                completedMutationSteps: run.completedMutationSteps,
                expiresAt: run.preflightExpiresAt,
                leaseId: args.leaseId,
                ...(run.mutationAuthorizedAt ? { mutationAuthorizedAt: run.mutationAuthorizedAt } : {}),
                ...(run.mutationAuthorizationLeaseId
                    ? { mutationAuthorizationLeaseId: run.mutationAuthorizationLeaseId }
                    : {}),
                nextStepSequence: run.nextStepSequence,
                now: args.now,
            })
        ) {
            throw new Error('blueprint-run-mutation-authorization-required');
        }
        const patch = { startedAt: args.now, state: 'started' as const, updatedAt: args.now };
        await ctx.db.patch('blueprintRunStepAttempts', attempt._id, patch);
        const remainingLeaseMs = run.leaseExpiresAt ? Date.parse(run.leaseExpiresAt) - Date.parse(args.now) : 0;
        const runPatch =
            remainingLeaseMs <= START_LEASE_RENEWAL_THRESHOLD_MS
                ? { heartbeatAt: args.now, leaseExpiresAt: args.leaseExpiresAt, updatedAt: args.now }
                : {};
        if (Object.keys(runPatch).length > 0) await patchBlueprintRunChecked(ctx, run, runPatch);
        return {
            kind: 'started' as const,
            attempt: { ...attempt, ...patch, id: attempt._id },
            run: { ...run, ...runPatch, id: run._id },
        };
    },
});

export const completeAndCheckpointBlueprintRunStepAttempt = mutation({
    args: {
        appliedSteps: v.number(),
        attemptId: v.id('blueprintRunStepAttempts'),
        completedMutationSteps: v.number(),
        createdId: v.optional(v.string()),
        currentStepDomain: v.optional(v.string()),
        currentStepId: v.optional(v.string()),
        currentStepLabel: v.optional(v.string()),
        errorType: v.optional(v.string()),
        failedSteps: v.number(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        nextStepSequence: v.number(),
        notStartedSteps: v.number(),
        now: v.string(),
        phase: v.union(
            v.literal('preparing'),
            v.literal('create'),
            v.literal('update'),
            v.literal('delete'),
            v.literal('channel_order'),
            v.literal('role_order'),
            v.literal('waiting_rate_limit'),
            v.literal('complete')
        ),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        retryAt: v.optional(v.string()),
        skippedSteps: v.number(),
        state: v.union(v.literal('applied'), v.literal('failed'), v.literal('unknown')),
        status: v.union(
            v.literal('running'),
            v.literal('pause_requested'),
            v.literal('waiting_rate_limit'),
            v.literal('partially_applied'),
            v.literal('failed_before_mutation'),
            v.literal('outcome_unknown')
        ),
        totalMutationSteps: v.number(),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const attempt = await ctx.db.get('blueprintRunStepAttempts', args.attemptId);
        if (!attempt) throw new Error('blueprint-run-step-attempt-not-found');
        await assertAttemptProjectionIntegrity(attempt);
        const completionDigest = await createBlueprintRunStepCompletionDigest(attempt, args);
        if (
            resolveBlueprintRunStepAttemptCompletionRetry({
                attemptState: attempt.state,
                ...(attempt.completionDigest ? { completionDigest: attempt.completionDigest } : {}),
                incomingDigest: completionDigest,
            }) === 'return_committed'
        ) {
            const committedRun = await ctx.db.get('blueprintRuns', attempt.runId);
            if (!committedRun) throw new Error('blueprint-run-not-found');
            return {
                attempt: { ...attempt, id: attempt._id },
                run: { ...committedRun, id: committedRun._id },
            };
        }
        const run = await requireRunLease(ctx, attempt.runId, args.leaseId, args.leaseOwner, args.now, [
            'running',
            'pause_requested',
        ]);
        if (
            attempt.state === 'pending' &&
            (args.state !== 'failed' || args.createdId !== undefined || args.retryAt !== undefined)
        ) {
            throw new Error('blueprint-run-step-attempt-provider-outcome-without-start');
        }
        if (
            attempt.planStepSequence !== run.nextStepSequence ||
            args.currentStepId !== String(attempt.planStepId) ||
            args.currentStepDomain !== attempt.targetType ||
            args.currentStepLabel !== attempt.displayLabel
        ) {
            throw new Error('blueprint-run-step-attempt-plan-step-invalid');
        }
        const cursor = await ctx.db
            .query('blueprintRunCursors')
            .withIndex('by_run', (q) => q.eq('runId', run._id))
            .unique();
        if (cursor?.planId !== run.planId) throw new Error('blueprint-run-cursor-invalid');
        const indexedAuthority =
            attempt.actionType === 'create' && args.state === 'applied'
                ? await loadBlueprintRunAttemptIndexedAuthority(ctx, run, attempt.targetId, args.createdId)
                : {
                      sourceMappingPresent: false,
                      sourceTargetId: undefined,
                      createdTargetKnown: false,
                  };
        const mappingDelta = validateBlueprintRunAttemptIndexedMappingDelta({
            planStep: attempt,
            attemptState: attempt.state,
            ...(args.createdId !== undefined ? { createdId: args.createdId } : {}),
            resultState: args.state,
            ...indexedAuthority,
        });
        if (mappingDelta) {
            const [existingSource, existingTarget] = await Promise.all([
                ctx.db
                    .query('blueprintRunIdMappings')
                    .withIndex('by_run_source', (q) => q.eq('runId', run._id).eq('sourceId', mappingDelta.sourceId))
                    .unique(),
                ctx.db
                    .query('blueprintRunIdMappings')
                    .withIndex('by_run_target', (q) => q.eq('runId', run._id).eq('targetId', mappingDelta.targetId))
                    .unique(),
            ]);
            if (existingSource || existingTarget) throw new Error('blueprint-run-id-mapping-conflict');
        }
        if (
            args.nextStepSequence !== attempt.planStepSequence &&
            args.nextStepSequence !== attempt.planStepSequence + 1
        ) {
            throw new Error('blueprint-run-progress-invalid');
        }
        validateBlueprintRunProgressTransition({
            next: args,
            previous: run,
        });
        validateBlueprintRunStepAttemptCompletionTransition({ attempt, args, run });
        const requestedTerminal =
            args.status === 'partially_applied' ||
            args.status === 'failed_before_mutation' ||
            args.status === 'outcome_unknown';
        if (
            (args.status === 'waiting_rate_limit' &&
                (args.state !== 'failed' || !args.retryAt || args.phase !== 'waiting_rate_limit')) ||
            (args.status === 'outcome_unknown' && (args.state !== 'unknown' || args.phase !== 'complete')) ||
            ((args.status === 'partially_applied' || args.status === 'failed_before_mutation') &&
                (args.state !== 'failed' || args.phase !== 'complete' || !args.errorType)) ||
            (args.status === 'failed_before_mutation' &&
                (args.appliedSteps !== 0 || args.completedMutationSteps !== 0)) ||
            (args.status === 'partially_applied' && args.appliedSteps === 0) ||
            (!requestedTerminal && args.phase === 'complete')
        ) {
            throw new Error('blueprint-run-attempt-outcome-invalid');
        }
        const resolvedStatus = resolveBlueprintRunStepAttemptCompletionStatus({
            controlRequest: run.controlRequest,
            runStatus: run.status,
            requestedStatus: args.status,
        });
        const controlStatus =
            resolvedStatus === 'paused' || resolvedStatus === 'cancelled' ? resolvedStatus : undefined;
        const resolvedPhase =
            controlStatus === 'paused' ? ('paused' as const) : controlStatus ? ('complete' as const) : args.phase;
        const terminal =
            resolvedStatus === 'partially_applied' ||
            resolvedStatus === 'failed_before_mutation' ||
            resolvedStatus === 'outcome_unknown' ||
            resolvedStatus === 'cancelled';
        const attemptPatch = {
            completedAt: args.now,
            completionDigest,
            ...(args.createdId ? { createdId: args.createdId } : {}),
            ...(args.errorType ? { errorType: args.errorType } : {}),
            ...(args.retryAt ? { retryAt: args.retryAt } : {}),
            state: args.state,
            updatedAt: args.now,
        };
        if (args.createdId) assertBoundedText(args.createdId, 256, 'blueprint-run-step-attempt-created-id-too-large');
        if (args.errorType) assertBoundedText(args.errorType, 256, 'blueprint-run-step-attempt-error-type-too-large');
        const runPatch = {
            appliedSteps: args.appliedSteps,
            completedMutationSteps: args.completedMutationSteps,
            currentStepDomain: args.currentStepDomain,
            currentStepId: args.currentStepId,
            currentStepLabel: args.currentStepLabel,
            failedSteps: args.failedSteps,
            errorType: controlStatus ? undefined : args.errorType,
            nextStepSequence: args.nextStepSequence,
            notStartedSteps: args.notStartedSteps,
            phase: resolvedPhase,
            retryAt: controlStatus || terminal ? undefined : args.retryAt,
            skippedSteps: args.skippedSteps,
            status: resolvedStatus,
            updatedAt: args.now,
            ...(resolvedStatus === 'waiting_rate_limit' || resolvedStatus === 'paused'
                ? {
                      controlRequest: undefined,
                      heartbeatAt: undefined,
                      leaseExpiresAt: undefined,
                      leaseId: undefined,
                      leaseOwner: undefined,
                  }
                : {}),
        };
        const cursorPatch = {
            mappingCount: cursor.mappingCount + (mappingDelta ? 1 : 0),
            updatedAt: args.now,
        };
        assertDocumentSize(
            { ...cursor, ...cursorPatch },
            MAX_BLUEPRINT_RUN_CURSOR_BYTES,
            'blueprint-run-cursor-too-large'
        );
        await ctx.db.patch('blueprintRunStepAttempts', attempt._id, attemptPatch);
        if (mappingDelta) {
            const mappingDocument = {
                createdAt: args.now,
                planId: run.planId,
                runId: run._id,
                sourceId: mappingDelta.sourceId,
                targetId: mappingDelta.targetId,
                version: 1,
            } as const;
            assertDocumentSize(
                mappingDocument,
                MAX_BLUEPRINT_RUN_ID_MAPPING_BYTES,
                'blueprint-run-id-mapping-too-large'
            );
            await ctx.db.insert('blueprintRunIdMappings', mappingDocument);
        }
        await ctx.db.patch('blueprintRunCursors', cursor._id, cursorPatch);
        let persistedRunPatch: Record<string, unknown> = runPatch;
        if (terminal) {
            await patchBlueprintRunChecked(ctx, run, runPatch);
            const cancellationRequestDigest =
                resolvedStatus === 'cancelled' && run.controlRequest === 'cancel'
                    ? await createBlueprintRunControlCancellationRequestDigest(String(run._id))
                    : undefined;
            const terminalPatch = await finalizeBlueprintRunInMutation(ctx, {
                run: applyBlueprintRunPatch(run, runPatch),
                now: args.now,
                status: resolvedStatus,
                ...(cancellationRequestDigest
                    ? { terminalRequestDigest: cancellationRequestDigest }
                    : { terminalRequestSourceDigest: completionDigest }),
                ...(args.errorType ? { errorType: args.errorType } : {}),
            });
            persistedRunPatch = { ...runPatch, ...terminalPatch };
        } else {
            await patchBlueprintRunChecked(ctx, run, runPatch);
            if (resolvedStatus === 'paused') {
                await recordBlueprintAuditInMutation(
                    ctx,
                    run.guildId,
                    { action: 'blueprint.run_paused' },
                    args.now,
                    String(run._id)
                );
            }
        }
        return {
            attempt: { ...attempt, ...attemptPatch, id: attempt._id },
            run: { ...run, ...persistedRunPatch, id: run._id },
        };
    },
});

async function loadBlueprintRunAttemptIndexedAuthority(
    ctx: MutationCtx,
    run: Doc<'blueprintRuns'>,
    sourceId: string,
    createdId: string | undefined
) {
    if (!createdId) throw new Error('blueprint-run-create-id-map-invalid');
    const manifestDocument = await ctx.db
        .query('blueprintPlanExecutionAuthorities')
        .withIndex('by_plan', (q) => q.eq('planId', run.planId))
        .unique();
    if (!manifestDocument) throw new Error('blueprint-plan-execution-authority-missing');
    const manifestResult = await validateBlueprintPlanExecutionAuthorityManifestIntegrity(
        stripConvexMetadata(manifestDocument)
    );
    if (
        manifestResult.type === 'invalid' ||
        manifestResult.value.planId !== String(run.planId) ||
        manifestResult.value.guildId !== run.guildId ||
        manifestResult.value.executionAuthorityDigest !== run.executionAuthorityDigest
    ) {
        throw new Error('blueprint-plan-execution-authority-integrity-invalid');
    }
    const [sourceBucketNumber, targetBucketNumber] = await Promise.all([
        getBlueprintPlanExecutionAuthorityBucket(sourceId),
        getBlueprintPlanExecutionAuthorityBucket(createdId),
    ]);
    const bucketNumbers = [...new Set([sourceBucketNumber, targetBucketNumber])];
    const bucketDocuments = await Promise.all(
        bucketNumbers.map((bucket) =>
            ctx.db
                .query('blueprintPlanExecutionAuthorityBuckets')
                .withIndex('by_plan_bucket', (q) => q.eq('planId', run.planId).eq('bucket', bucket))
                .unique()
        )
    );
    const buckets = new Map<number, BlueprintPlanExecutionAuthorityBucketV1>();
    for (let index = 0; index < bucketNumbers.length; index += 1) {
        const expectedBucket = bucketNumbers[index];
        const document = bucketDocuments[index];
        if (expectedBucket === undefined || !document) {
            throw new Error('blueprint-plan-execution-authority-bucket-missing');
        }
        const result = await validateBlueprintPlanExecutionAuthorityBucketIntegrity({
            bucket: stripConvexMetadata(document),
            manifest: manifestResult.value,
            expectedBucket,
        });
        if (result.type === 'invalid') {
            throw new Error('blueprint-plan-execution-authority-bucket-integrity-invalid');
        }
        buckets.set(expectedBucket, result.value);
    }
    const sourceBucket = buckets.get(sourceBucketNumber);
    const targetBucket = buckets.get(targetBucketNumber);
    if (!sourceBucket || !targetBucket) throw new Error('blueprint-plan-execution-authority-bucket-missing');
    return {
        sourceMappingPresent: Object.hasOwn(sourceBucket.sourceTargetMap, sourceId),
        sourceTargetId: sourceBucket.sourceTargetMap[sourceId],
        createdTargetKnown: Object.hasOwn(targetBucket.knownTargetKinds, createdId),
    };
}

async function createBlueprintRunStepCompletionDigest(
    attempt: { _id: unknown; planStepId: unknown },
    args: {
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
        phase: string;
        retryAt?: string;
        skippedSteps: number;
        state: string;
        status: string;
        totalMutationSteps: number;
    }
): Promise<string> {
    return sha256CanonicalJson({
        domain: 'neonflux.blueprint.run-step-completion',
        version: 1,
        attemptId: String(attempt._id),
        planStepId: String(attempt.planStepId),
        appliedSteps: args.appliedSteps,
        completedMutationSteps: args.completedMutationSteps,
        ...(args.createdId !== undefined ? { createdId: args.createdId } : {}),
        ...(args.currentStepDomain !== undefined ? { currentStepDomain: args.currentStepDomain } : {}),
        ...(args.currentStepId !== undefined ? { currentStepId: args.currentStepId } : {}),
        ...(args.currentStepLabel !== undefined ? { currentStepLabel: args.currentStepLabel } : {}),
        ...(args.errorType !== undefined ? { errorType: args.errorType } : {}),
        failedSteps: args.failedSteps,
        nextStepSequence: args.nextStepSequence,
        notStartedSteps: args.notStartedSteps,
        phase: args.phase,
        ...(args.retryAt !== undefined ? { retryAt: args.retryAt } : {}),
        skippedSteps: args.skippedSteps,
        state: args.state,
        status: args.status,
        totalMutationSteps: args.totalMutationSteps,
    });
}

async function createAttemptProjection(planStepId: unknown, sequence: number, step: unknown) {
    if (!isRecord(step)) throw new Error('blueprint-plan-step-invalid');
    const actionType = requireLiteral(step.actionType, ['create', 'update', 'delete'] as const);
    const targetType = requireLiteral(step.targetType, [
        'role',
        'category',
        'channel',
        'role-order',
        'channel-order',
    ] as const);
    const targetId = requireBoundedText(step.targetId, 256, 'blueprint-run-step-attempt-target-id-too-large');
    const displayLabel = requireBoundedText(step.label, 512, 'blueprint-run-step-attempt-label-too-large');
    const details = isRecord(step.details) ? step.details : undefined;
    const sourceId =
        details?.sourceId === undefined
            ? undefined
            : requireBoundedText(details.sourceId, 256, 'blueprint-run-step-attempt-source-id-too-large');
    const projection = {
        actionType,
        displayLabel,
        planStepSequence: sequence,
        ...(sourceId ? { sourceId } : {}),
        targetId,
        targetType,
    };
    return {
        ...projection,
        stepDigest: await createAttemptProjectionDigest({ ...projection, planStepId }),
    };
}

async function assertAttemptProjectionIntegrity(attempt: {
    actionType: string;
    displayLabel: string;
    planStepId: unknown;
    planStepSequence: number;
    sourceId?: string;
    stepDigest: string;
    targetId: string;
    targetType: string;
}): Promise<void> {
    const expected = await createAttemptProjectionDigest(attempt);
    if (attempt.stepDigest !== expected) throw new Error('blueprint-run-step-attempt-projection-invalid');
}

async function createAttemptProjectionDigest(projection: {
    actionType: string;
    displayLabel: string;
    planStepId: unknown;
    planStepSequence: number;
    sourceId?: string;
    targetId: string;
    targetType: string;
}): Promise<string> {
    return sha256CanonicalJson({
        domain: 'neonflux.blueprint.run-step-projection',
        version: 1,
        actionType: projection.actionType,
        displayLabel: projection.displayLabel,
        planStepId: String(projection.planStepId),
        planStepSequence: projection.planStepSequence,
        ...(projection.sourceId ? { sourceId: projection.sourceId } : {}),
        targetId: projection.targetId,
        targetType: projection.targetType,
    });
}

function prepareRunPatch(
    _run: { status: string },
    attempt: { planStepId: unknown; targetType: string; displayLabel: string },
    now: string,
    leaseExpiresAt: string
) {
    return {
        currentStepDomain: attempt.targetType,
        currentStepId: String(attempt.planStepId),
        currentStepLabel: attempt.displayLabel,
        heartbeatAt: now,
        leaseExpiresAt,
        phase: phaseForAttempt(attempt),
        updatedAt: now,
    };
}

function phaseForAttempt(attempt: { targetType: string; actionType?: string }) {
    if (attempt.targetType === 'role-order') return 'role_order' as const;
    if (attempt.targetType === 'channel-order') return 'channel_order' as const;
    if (attempt.actionType === 'create') return 'create' as const;
    if (attempt.actionType === 'delete') return 'delete' as const;
    return 'update' as const;
}

function requireLiteral<const T extends string>(value: unknown, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error('blueprint-plan-step-invalid');
    return value as T;
}

function requireBoundedText(value: unknown, maximumBytes: number, errorType: string): string {
    if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) throw new Error(errorType);
    assertBoundedText(value, maximumBytes, errorType);
    return value;
}

function assertDocumentSize(value: unknown, maximumBytes: number, errorType: string): void {
    if (!isRecord(value) || getDocumentSize(value as Record<string, Value>) > maximumBytes) throw new Error(errorType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripConvexMetadata<T extends { _id: unknown; _creationTime: unknown }>(
    value: T
): Omit<T, '_id' | '_creationTime'> {
    const { _id: ignoredId, _creationTime: ignoredCreationTime, ...document } = value;
    void ignoredId;
    void ignoredCreationTime;
    return document;
}

function assertBoundedText(value: string, maximumBytes: number, errorType: string): void {
    if (new TextEncoder().encode(value).byteLength > maximumBytes) throw new Error(errorType);
}
