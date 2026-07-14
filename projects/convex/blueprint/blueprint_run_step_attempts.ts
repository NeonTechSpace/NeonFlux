import { v } from 'convex/values';

import { mutation } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { blueprintRunLiveAreas } from '../core/dashboard_live_model.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { recordBlueprintAuditInMutation } from './blueprint.js';
import { requireRunLease } from './blueprint_run.js';
import { finalizeBlueprintRunInMutation } from './blueprint_run_terminal_mutation.js';
import {
    resolveBlueprintRunStepAttemptCompletionStatus,
    isBlueprintRunMutationAuthorizedForLease,
    validateBlueprintRunAttemptIdMapTransition,
    validateBlueprintRunProgressTransition,
} from './blueprint_model.js';

export const prepareBlueprintRunStepAttempt = mutation({
    args: {
        planStepId: v.id('blueprintPlanSteps'),
        attempt: v.number(),
        runId: v.id('blueprintRuns'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        requestKey: v.string(),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const run = await requireRunLease(ctx, args.runId, args.leaseId, args.leaseOwner, args.now, [
            'running',
            'pause_requested',
        ]);
        if (!Number.isInteger(args.attempt) || args.attempt < 1)
            throw new Error('blueprint-run-step-attempt-number-invalid');
        const planStep = await ctx.db.get('blueprintPlanSteps', args.planStepId);
        if (planStep?.planId !== run.planId || planStep.sequence !== run.nextStepSequence) {
            throw new Error('blueprint-run-step-attempt-plan-step-invalid');
        }
        const existing = await ctx.db
            .query('blueprintRunStepAttempts')
            .withIndex('by_run_plan_step_attempt', (q) =>
                q.eq('runId', args.runId).eq('planStepId', args.planStepId).eq('attempt', args.attempt)
            )
            .first();
        if (existing) return { ...existing, id: existing._id };
        const document = {
            planStepId: args.planStepId,
            attempt: args.attempt,
            createdAt: args.now,
            runId: args.runId,
            requestKey: args.requestKey,
            state: 'pending' as const,
            updatedAt: args.now,
        };
        const id = await ctx.db.insert('blueprintRunStepAttempts', document);
        return { id, ...document };
    },
});

export const startBlueprintRunStepAttempt = mutation({
    args: {
        attemptId: v.id('blueprintRunStepAttempts'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const attempt = await ctx.db.get('blueprintRunStepAttempts', args.attemptId);
        if (!attempt) throw new Error('blueprint-run-step-attempt-not-found');
        const run = await requireRunLease(ctx, attempt.runId, args.leaseId, args.leaseOwner, args.now, ['running']);
        if (attempt.state !== 'pending') throw new Error('blueprint-run-step-attempt-not-pending');
        const planStep = await ctx.db.get('blueprintPlanSteps', attempt.planStepId);
        if (planStep?.planId !== run.planId || planStep.sequence !== run.nextStepSequence) {
            throw new Error('blueprint-run-step-attempt-plan-step-invalid');
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
        return { ...attempt, ...patch, id: attempt._id };
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
        idMapJson: v.string(),
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
        const run = await requireRunLease(ctx, attempt.runId, args.leaseId, args.leaseOwner, args.now, [
            'running',
            'pause_requested',
        ]);
        if (attempt.state !== 'pending' && attempt.state !== 'started')
            throw new Error('blueprint-run-step-attempt-terminal');
        if (
            attempt.state === 'pending' &&
            (args.state !== 'failed' || args.createdId !== undefined || args.retryAt !== undefined)
        ) {
            throw new Error('blueprint-run-step-attempt-provider-outcome-without-start');
        }
        const planStep = await ctx.db.get('blueprintPlanSteps', attempt.planStepId);
        if (
            planStep?.planId !== run.planId ||
            planStep.sequence !== run.nextStepSequence ||
            args.currentStepId !== String(planStep._id)
        ) {
            throw new Error('blueprint-run-step-attempt-plan-step-invalid');
        }
        const plan = await ctx.db.get('blueprintPlans', run.planId);
        if (!plan) throw new Error('blueprint-plan-not-found');
        const nextIdMap = validateBlueprintRunAttemptIdMapTransition({
            planStep,
            attemptState: attempt.state,
            ...(args.createdId !== undefined ? { createdId: args.createdId } : {}),
            plan: plan.plan,
            previous: run.idMap,
            next: parseJsonRecord(args.idMapJson),
            resultState: args.state,
        });
        if (args.nextStepSequence !== planStep.sequence && args.nextStepSequence !== planStep.sequence + 1) {
            throw new Error('blueprint-run-progress-invalid');
        }
        validateBlueprintRunProgressTransition({
            next: args,
            previous: run,
        });
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
            ...(args.createdId ? { createdId: args.createdId } : {}),
            ...(args.errorType ? { errorType: args.errorType } : {}),
            ...(args.retryAt ? { retryAt: args.retryAt } : {}),
            state: args.state,
            updatedAt: args.now,
        };
        const runPatch = {
            appliedSteps: args.appliedSteps,
            completedMutationSteps: args.completedMutationSteps,
            ...(args.currentStepDomain ? { currentStepDomain: args.currentStepDomain } : {}),
            ...(args.currentStepId ? { currentStepId: args.currentStepId } : {}),
            ...(args.currentStepLabel ? { currentStepLabel: args.currentStepLabel } : {}),
            failedSteps: args.failedSteps,
            errorType: controlStatus ? undefined : args.errorType,
            idMap: nextIdMap,
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
        await ctx.db.patch('blueprintRunStepAttempts', attempt._id, attemptPatch);
        let persistedRunPatch: Record<string, unknown> = runPatch;
        if (terminal) {
            await ctx.db.patch('blueprintRuns', run._id, runPatch);
            const terminalPatch = await finalizeBlueprintRunInMutation(ctx, {
                run,
                now: args.now,
                status: resolvedStatus,
                ...(args.errorType ? { errorType: args.errorType } : {}),
            });
            persistedRunPatch = { ...runPatch, ...terminalPatch };
        } else {
            await ctx.db.patch('blueprintRuns', run._id, runPatch);
            await markDashboardLiveAreasChangedInMutation(ctx, {
                areas: blueprintRunLiveAreas,
                guildId: run.guildId,
                now: args.now,
            });
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

function parseJsonRecord(value: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // The stable domain error below is the only parse detail callers need.
    }
    throw new Error('blueprint-run-id-map-invalid');
}
