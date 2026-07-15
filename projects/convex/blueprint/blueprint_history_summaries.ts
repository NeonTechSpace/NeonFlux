import { v, type GenericId } from 'convex/values';

import { query } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import {
    hotRunRecordValidator,
    planMetadataRecordValidator,
    preflightMetadataRecordValidator,
    toHotRunRecord,
    toPlanMetadataRecord,
    toPreflightMetadataRecord,
} from './blueprint_hot_records.js';

export const listBlueprintPlanSummariesByGuildId = query({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(planMetadataRecordValidator),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const guildId = requireCanonicalText(args.guildId, 'blueprint-plan-guild-invalid');
        const limit = Math.min(Math.max(Math.trunc(args.limit ?? 20), 1), 20);
        const plans = await ctx.db
            .query('blueprintPlans')
            .withIndex('by_guild_sealed', (q) => q.eq('guildId', guildId).gte('sealedAt', ''))
            .order('desc')
            .take(limit);
        return plans.map(toPlanMetadataRecord);
    },
});

export const listLatestBlueprintPlanPreflightSummaries = query({
    args: { guildId: v.string(), planIds: v.array(v.id('blueprintPlans')) },
    returns: v.record(v.string(), v.union(preflightMetadataRecordValidator, v.null())),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        assertBoundedUniquePlanIds(args.planIds);
        const entries = await Promise.all(
            args.planIds.map(async (planId) => {
                const preflight = await ctx.db
                    .query('blueprintPlanPreflights')
                    .withIndex('by_plan_checked', (q) => q.eq('planId', planId))
                    .order('desc')
                    .first();
                return [
                    String(planId),
                    preflight?.guildId === args.guildId ? toPreflightMetadataRecord(preflight) : null,
                ] as const;
            })
        );
        return Object.fromEntries(entries);
    },
});

export const listLatestBlueprintRunSummaries = query({
    args: { guildId: v.string(), planIds: v.array(v.id('blueprintPlans')) },
    returns: v.record(v.string(), v.union(hotRunRecordValidator, v.null())),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        assertBoundedUniquePlanIds(args.planIds);
        const entries = await Promise.all(
            args.planIds.map(async (planId) => {
                const run = await ctx.db
                    .query('blueprintRuns')
                    .withIndex('by_plan_created', (q) => q.eq('planId', planId))
                    .order('desc')
                    .first();
                return [String(planId), run?.guildId === args.guildId ? toHotRunRecord(run) : null] as const;
            })
        );
        return Object.fromEntries(entries);
    },
});

function assertBoundedUniquePlanIds(planIds: ReadonlyArray<GenericId<'blueprintPlans'>>): void {
    if (planIds.length > 20 || new Set(planIds.map(String)).size !== planIds.length) {
        throw new Error('blueprint-plan-ids-invalid');
    }
}

function requireCanonicalText(value: string, errorType: string): string {
    if (value.length === 0 || value !== value.trim()) throw new Error(errorType);
    return value;
}
