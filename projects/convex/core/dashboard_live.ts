import { v } from 'convex/values';

import { requireGuildAccess, requireNeonFluxService } from '../auth.js';
import {
    dashboardLiveAreas,
    normalizeDashboardLiveAreas,
    normalizeDashboardLiveGuildId,
    type DashboardLiveArea,
    type DashboardLiveStateRecord,
} from './dashboard_live_model.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
type DashboardLiveMutationCtx = MutationCtx;
type DashboardLiveQueryCtx = QueryCtx;

const allowedLiveMutationServices = ['bot', 'web'] as const;
const dashboardOverviewAggregateWatchLimit = 30 * 64;
const dashboardLiveAreaValidator = v.union(...dashboardLiveAreas.map((area) => v.literal(area)));
const dashboardLiveStateValidator = v.object({
    area: dashboardLiveAreaValidator,
    guildId: v.string(),
    updatedAt: v.string(),
    version: v.number(),
});

export const listDashboardLiveStates = query({
    args: {
        areas: v.array(dashboardLiveAreaValidator),
        guildId: v.string(),
    },
    returns: v.array(dashboardLiveStateValidator),
    handler: async (ctx: DashboardLiveQueryCtx, args) => {
        const guildId = normalizeDashboardLiveGuildId(args.guildId);
        await requireGuildAccess(ctx, guildId);

        const states: DashboardLiveStateRecord[] = [];

        for (const area of normalizeDashboardLiveAreas(args.areas)) {
            const state = await ctx.db
                .query('dashboardLiveStates')
                .withIndex('by_guild_area', (query) => query.eq('guildId', guildId).eq('area', area))
                .unique();

            const baseState = state
                ? toDashboardLiveStateRecord(state)
                : {
                      area,
                      guildId,
                      updatedAt: '',
                      version: 0,
                  };

            states.push(area === 'overview' ? await addOverviewGrowthSignal(ctx, baseState) : baseState);
        }

        return states;
    },
});

export const markDashboardLiveAreasChanged = mutation({
    args: {
        areas: v.array(dashboardLiveAreaValidator),
        guildId: v.string(),
    },
    returns: v.array(dashboardLiveStateValidator),
    handler: async (ctx: DashboardLiveMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedLiveMutationServices);
        return markDashboardLiveAreasChangedInMutation(ctx, {
            areas: normalizeDashboardLiveAreas(args.areas),
            guildId: args.guildId,
        });
    },
});

export async function markDashboardLiveAreasChangedInMutation(
    ctx: DashboardLiveMutationCtx,
    input: {
        areas: readonly DashboardLiveArea[];
        guildId: string;
        now?: string;
    }
): Promise<DashboardLiveStateRecord[]> {
    const guildId = normalizeDashboardLiveGuildId(input.guildId);

    if (!guildId) {
        return [];
    }

    const now = input.now ?? new Date().toISOString();
    const states: DashboardLiveStateRecord[] = [];

    for (const area of normalizeDashboardLiveAreas(input.areas)) {
        const existing = await ctx.db
            .query('dashboardLiveStates')
            .withIndex('by_guild_area', (query) => query.eq('guildId', guildId).eq('area', area))
            .unique();

        if (existing) {
            const nextVersion = existing.version + 1;
            await ctx.db.patch('dashboardLiveStates', existing._id, {
                updatedAt: now,
                version: nextVersion,
            });
            states.push({
                area,
                guildId,
                updatedAt: now,
                version: nextVersion,
            });
            continue;
        }

        const state = {
            area,
            guildId,
            updatedAt: now,
            version: 1,
        };
        await ctx.db.insert('dashboardLiveStates', state);
        states.push(state);
    }

    return states;
}

function toDashboardLiveStateRecord(record: {
    area: string;
    guildId: string;
    updatedAt: string;
    version: number;
}): DashboardLiveStateRecord {
    return {
        area: record.area as DashboardLiveArea,
        guildId: record.guildId,
        updatedAt: record.updatedAt,
        version: record.version,
    };
}

async function addOverviewGrowthSignal(
    ctx: DashboardLiveQueryCtx,
    state: DashboardLiveStateRecord
): Promise<DashboardLiveStateRecord> {
    const [dailyAggregates, growthState] = await Promise.all([
        ctx.db
            .query('guildGrowthDailyAggregates')
            .withIndex('by_guild_date', (query) => query.eq('guildId', state.guildId))
            .order('desc')
            .take(dashboardOverviewAggregateWatchLimit),
        ctx.db
            .query('guildGrowthStates')
            .withIndex('by_guild', (query) => query.eq('guildId', state.guildId))
            .unique(),
    ]);
    let version = state.version;
    let updatedAt = state.updatedAt;

    for (const aggregate of dailyAggregates) {
        version +=
            aggregate.joins +
            aggregate.leaves +
            aggregate.messageCount +
            aggregate.ambiguousCount +
            aggregate.attributedCount +
            aggregate.baselineMissingCount +
            aggregate.notApplicableCount +
            aggregate.unavailableCount;
        updatedAt = laterTimestamp(updatedAt, aggregate.updatedAt);
    }

    if (growthState) {
        updatedAt = laterTimestamp(updatedAt, growthState.updatedAt);
    }

    return { ...state, updatedAt, version };
}

function laterTimestamp(left: string, right: string): string {
    return left >= right ? left : right;
}
