import { v } from 'convex/values';

import { query } from '../_generated/server.js';
import { requireGuildAccess } from '../auth.js';

const executionProgressValidator = v.object({
    appliedActions: v.number(),
    completedAt: v.optional(v.string()),
    completedMutationSteps: v.number(),
    createdAt: v.string(),
    currentActionDomain: v.optional(v.string()),
    currentActionId: v.optional(v.string()),
    currentActionLabel: v.optional(v.string()),
    errorType: v.optional(v.string()),
    failedActions: v.number(),
    id: v.string(),
    nextActionSequence: v.number(),
    notStartedActions: v.number(),
    phase: v.string(),
    retryAt: v.optional(v.string()),
    skippedActions: v.number(),
    startedAt: v.optional(v.string()),
    status: v.string(),
    totalActions: v.number(),
    totalMutationSteps: v.number(),
    updatedAt: v.string(),
});

export const findStructureImportExecutionProgressForGuild = query({
    args: { guildId: v.string(), runId: v.id('structureImportRuns') },
    returns: v.union(v.null(), executionProgressValidator),
    handler: async (ctx, args) => {
        await requireGuildAccess(ctx, args.guildId);
        const run = await ctx.db.get('structureImportRuns', args.runId);
        if (run?.guildId !== args.guildId) return null;
        const execution = await ctx.db
            .query('structureImportExecutions')
            .withIndex('by_run_created', (q) => q.eq('runId', args.runId))
            .order('desc')
            .first();
        if (!execution) return null;
        return {
            appliedActions: execution.appliedActions,
            ...(execution.completedAt ? { completedAt: execution.completedAt } : {}),
            completedMutationSteps: execution.completedMutationSteps,
            createdAt: execution.createdAt,
            ...(execution.currentActionDomain ? { currentActionDomain: execution.currentActionDomain } : {}),
            ...(execution.currentActionId ? { currentActionId: execution.currentActionId } : {}),
            ...(execution.currentActionLabel ? { currentActionLabel: execution.currentActionLabel } : {}),
            ...(execution.errorType ? { errorType: execution.errorType } : {}),
            failedActions: execution.failedActions,
            id: String(execution._id),
            nextActionSequence: execution.nextActionSequence,
            notStartedActions: execution.notStartedActions,
            phase: execution.phase,
            ...(execution.retryAt ? { retryAt: execution.retryAt } : {}),
            skippedActions: execution.skippedActions,
            ...(execution.startedAt ? { startedAt: execution.startedAt } : {}),
            status: execution.status,
            totalActions: execution.totalActions,
            totalMutationSteps: execution.totalMutationSteps,
            updatedAt: execution.updatedAt,
        };
    },
});
