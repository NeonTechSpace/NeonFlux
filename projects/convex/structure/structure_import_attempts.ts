import { v } from 'convex/values';

import { mutation } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { structureExecutionLiveAreas } from '../core/dashboard_live_model.js';
import { requireExecutionLease } from './structure_import_execution.js';

export const startStructureImportActionAttempt = mutation({
    args: {
        actionId: v.id('structureImportActions'),
        attempt: v.number(),
        executionId: v.id('structureImportExecutions'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        requestKey: v.string(),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const execution = await requireExecutionLease(ctx, args.executionId, args.leaseId, args.leaseOwner, args.now, [
            'running',
            'pause_requested',
        ]);
        if (!Number.isInteger(args.attempt) || args.attempt < 1) throw new Error('structure-attempt-number-invalid');
        const action = await ctx.db.get('structureImportActions', args.actionId);
        if (action?.runId !== execution.runId || action.sequence < execution.nextActionSequence) {
            throw new Error('structure-attempt-action-invalid');
        }
        const existing = await ctx.db
            .query('structureImportActionAttempts')
            .withIndex('by_execution_action_attempt', (q) =>
                q.eq('executionId', args.executionId).eq('actionId', args.actionId).eq('attempt', args.attempt)
            )
            .first();
        if (existing) return { ...existing, id: existing._id };
        const document = {
            actionId: args.actionId,
            attempt: args.attempt,
            createdAt: args.now,
            executionId: args.executionId,
            requestKey: args.requestKey,
            startedAt: args.now,
            state: 'started' as const,
            updatedAt: args.now,
        };
        const id = await ctx.db.insert('structureImportActionAttempts', document);
        return { id, ...document };
    },
});

export const completeStructureImportActionAttempt = mutation({
    args: {
        attemptId: v.id('structureImportActionAttempts'),
        createdId: v.optional(v.string()),
        errorType: v.optional(v.string()),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        retryAt: v.optional(v.string()),
        state: v.union(v.literal('applied'), v.literal('failed'), v.literal('unknown')),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const attempt = await ctx.db.get('structureImportActionAttempts', args.attemptId);
        if (!attempt) return null;
        await requireExecutionLease(ctx, attempt.executionId, args.leaseId, args.leaseOwner, args.now, [
            'running',
            'pause_requested',
        ]);
        if (attempt.state !== 'started') throw new Error('structure-attempt-terminal');
        const patch = {
            completedAt: args.now,
            ...(args.createdId ? { createdId: args.createdId } : {}),
            ...(args.errorType ? { errorType: args.errorType } : {}),
            ...(args.retryAt ? { retryAt: args.retryAt } : {}),
            state: args.state,
            updatedAt: args.now,
        };
        await ctx.db.patch('structureImportActionAttempts', attempt._id, patch);
        return { ...attempt, ...patch, id: attempt._id };
    },
});

export const completeAndCheckpointStructureImportActionAttempt = mutation({
    args: {
        appliedActions: v.number(),
        attemptId: v.id('structureImportActionAttempts'),
        completedMutationSteps: v.number(),
        createdId: v.optional(v.string()),
        currentActionDomain: v.optional(v.string()),
        currentActionId: v.optional(v.string()),
        currentActionLabel: v.optional(v.string()),
        errorType: v.optional(v.string()),
        failedActions: v.number(),
        idMapJson: v.string(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        nextActionSequence: v.number(),
        notStartedActions: v.number(),
        now: v.string(),
        phase: v.union(
            v.literal('preparing'),
            v.literal('create'),
            v.literal('update'),
            v.literal('delete'),
            v.literal('channel_order'),
            v.literal('role_order')
        ),
        retryAt: v.optional(v.string()),
        skippedActions: v.number(),
        state: v.union(v.literal('applied'), v.literal('failed'), v.literal('unknown')),
        status: v.union(v.literal('running'), v.literal('pause_requested')),
        totalMutationSteps: v.number(),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const attempt = await ctx.db.get('structureImportActionAttempts', args.attemptId);
        if (attempt?.state !== 'started') throw new Error('structure-attempt-terminal');
        const execution = await requireExecutionLease(
            ctx,
            attempt.executionId,
            args.leaseId,
            args.leaseOwner,
            args.now,
            ['running', 'pause_requested']
        );
        const action = await ctx.db.get('structureImportActions', attempt.actionId);
        if (action?.runId !== execution.runId || args.currentActionId !== String(action._id)) {
            throw new Error('structure-attempt-action-invalid');
        }
        if (
            args.nextActionSequence < execution.nextActionSequence ||
            args.nextActionSequence > execution.totalActions ||
            (args.nextActionSequence !== action.sequence && args.nextActionSequence !== action.sequence + 1) ||
            args.completedMutationSteps > args.totalMutationSteps ||
            args.totalMutationSteps !== execution.totalMutationSteps ||
            [
                args.appliedActions,
                args.completedMutationSteps,
                args.failedActions,
                args.nextActionSequence,
                args.notStartedActions,
                args.skippedActions,
            ].some((value) => !Number.isInteger(value) || value < 0)
        ) {
            throw new Error('structure-execution-progress-invalid');
        }
        if (execution.status === 'pause_requested' && args.status !== 'pause_requested') {
            throw new Error('structure-execution-pause-fence');
        }
        const attemptPatch = {
            completedAt: args.now,
            ...(args.createdId ? { createdId: args.createdId } : {}),
            ...(args.errorType ? { errorType: args.errorType } : {}),
            ...(args.retryAt ? { retryAt: args.retryAt } : {}),
            state: args.state,
            updatedAt: args.now,
        };
        const executionPatch = {
            appliedActions: args.appliedActions,
            completedMutationSteps: args.completedMutationSteps,
            ...(args.currentActionDomain ? { currentActionDomain: args.currentActionDomain } : {}),
            ...(args.currentActionId ? { currentActionId: args.currentActionId } : {}),
            ...(args.currentActionLabel ? { currentActionLabel: args.currentActionLabel } : {}),
            failedActions: args.failedActions,
            idMap: parseJsonRecord(args.idMapJson),
            nextActionSequence: args.nextActionSequence,
            notStartedActions: args.notStartedActions,
            phase: args.phase,
            skippedActions: args.skippedActions,
            status: args.status,
            updatedAt: args.now,
        };
        await ctx.db.patch('structureImportActionAttempts', attempt._id, attemptPatch);
        await ctx.db.patch('structureImportExecutions', execution._id, executionPatch);
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: structureExecutionLiveAreas,
            guildId: execution.guildId,
            now: args.now,
        });
        return {
            attempt: { ...attempt, ...attemptPatch, id: attempt._id },
            execution: { ...execution, ...executionPatch, id: execution._id },
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
    throw new Error('structure-execution-id-map-invalid');
}
