import {
    mutationGeneric,
    queryGeneric,
    type DataModelFromSchemaDefinition,
    type GenericMutationCtx,
} from 'convex/server';
import { v } from 'convex/values';

import { requireGuildAccess, requireNeonFluxService } from '../auth.js';
import type schema from '../schema.js';
import {
    dashboardLiveAreas,
    normalizeDashboardLiveAreas,
    normalizeDashboardLiveGuildId,
    type DashboardLiveArea,
    type DashboardLiveStateRecord,
} from './dashboard_live_model.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type DashboardLiveMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

const allowedLiveMutationServices = ['bot', 'web'] as const;
const dashboardLiveAreaValidator = v.union(...dashboardLiveAreas.map((area) => v.literal(area)));
const dashboardLiveStateValidator = v.object({
    area: dashboardLiveAreaValidator,
    guildId: v.string(),
    updatedAt: v.string(),
    version: v.number(),
});

export const listDashboardLiveStates = queryGeneric({
    args: {
        areas: v.array(dashboardLiveAreaValidator),
        guildId: v.string(),
    },
    returns: v.array(dashboardLiveStateValidator),
    handler: async (ctx, args) => {
        const guildId = normalizeDashboardLiveGuildId(args.guildId);
        await requireGuildAccess(ctx, guildId);

        const states: DashboardLiveStateRecord[] = [];

        for (const area of normalizeDashboardLiveAreas(args.areas)) {
            const state = await ctx.db
                .query('dashboardLiveStates')
                .withIndex('by_guild_area', (query) => query.eq('guildId', guildId))
                .filter((query) => query.eq(query.field('area'), area))
                .unique();

            states.push(
                state
                    ? toDashboardLiveStateRecord(state)
                    : {
                          area,
                          guildId,
                          updatedAt: '',
                          version: 0,
                      }
            );
        }

        return states;
    },
});

export const markDashboardLiveAreasChanged = mutationGeneric({
    args: {
        areas: v.array(dashboardLiveAreaValidator),
        guildId: v.string(),
    },
    returns: v.array(dashboardLiveStateValidator),
    handler: async (ctx, args) => {
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
            .withIndex('by_guild_area', (query) => query.eq('guildId', guildId))
            .filter((query) => query.eq(query.field('area'), area))
            .unique();

        if (existing) {
            const nextVersion = existing.version + 1;
            await ctx.db.patch(existing._id, {
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
