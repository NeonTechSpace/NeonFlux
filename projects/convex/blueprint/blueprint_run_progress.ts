import { v } from 'convex/values';

import { query } from '../_generated/server.js';
import { requireActiveGuildAccess } from '../auth.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';

const runProgressValidator = v.object({
    appliedSteps: v.number(),
    completedAt: v.optional(v.string()),
    completedMutationSteps: v.number(),
    createdAt: v.string(),
    currentStepDomain: v.optional(v.string()),
    currentStepId: v.optional(v.string()),
    currentStepLabel: v.optional(v.string()),
    errorType: v.optional(v.string()),
    failedSteps: v.number(),
    id: v.string(),
    nextStepSequence: v.number(),
    notStartedSteps: v.number(),
    phase: v.string(),
    protocolVersion: v.number(),
    retryAt: v.optional(v.string()),
    skippedSteps: v.number(),
    startedAt: v.optional(v.string()),
    status: v.string(),
    totalSteps: v.number(),
    totalMutationSteps: v.number(),
    updatedAt: v.string(),
});

export const findBlueprintRunProgressForGuild = query({
    args: {
        guildId: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        planId: v.id('blueprintPlans'),
    },
    returns: v.union(v.null(), runProgressValidator),
    handler: async (ctx, args) => {
        await requireActiveGuildAccess(ctx, args.guildId);
        const run = await ctx.db
            .query('blueprintRuns')
            .withIndex('by_plan_created', (q) => q.eq('planId', args.planId))
            .order('desc')
            .first();
        if (run?.guildId !== args.guildId) return null;
        return {
            appliedSteps: run.appliedSteps,
            ...(run.completedAt ? { completedAt: run.completedAt } : {}),
            completedMutationSteps: run.completedMutationSteps,
            createdAt: run.createdAt,
            ...(run.currentStepDomain ? { currentStepDomain: run.currentStepDomain } : {}),
            ...(run.currentStepId ? { currentStepId: run.currentStepId } : {}),
            ...(run.currentStepLabel ? { currentStepLabel: run.currentStepLabel } : {}),
            ...(run.errorType ? { errorType: run.errorType } : {}),
            failedSteps: run.failedSteps,
            id: String(run._id),
            nextStepSequence: run.nextStepSequence,
            notStartedSteps: run.notStartedSteps,
            phase: run.phase,
            protocolVersion: run.protocolVersion,
            ...(run.retryAt ? { retryAt: run.retryAt } : {}),
            skippedSteps: run.skippedSteps,
            ...(run.startedAt ? { startedAt: run.startedAt } : {}),
            status: run.status,
            totalSteps: run.totalSteps,
            totalMutationSteps: run.totalMutationSteps,
            updatedAt: run.updatedAt,
        };
    },
});
