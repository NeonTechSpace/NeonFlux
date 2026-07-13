import { v } from 'convex/values';

import { requireNeonFluxUser } from '../auth.js';
import { query, type MutationCtx, type QueryCtx } from '../_generated/server.js';

type DashboardCatalogMutationCtx = MutationCtx;
type DashboardCatalogQueryCtx = QueryCtx;

const dashboardCatalogStateKey = 'guild-catalog';
const dashboardCatalogStateValidator = v.object({
    updatedAt: v.string(),
    version: v.number(),
});

export type DashboardCatalogStateRecord = {
    updatedAt: string;
    version: number;
};

export const readDashboardCatalogState = query({
    args: {},
    returns: dashboardCatalogStateValidator,
    handler: async (ctx: DashboardCatalogQueryCtx) => {
        await requireNeonFluxUser(ctx);
        const state = await ctx.db
            .query('dashboardCatalogStates')
            .withIndex('by_key', (query) => query.eq('key', dashboardCatalogStateKey))
            .unique();

        return state ? { updatedAt: state.updatedAt, version: state.version } : { updatedAt: '', version: 0 };
    },
});

export async function markDashboardCatalogChangedInMutation(
    ctx: DashboardCatalogMutationCtx,
    now = new Date().toISOString()
): Promise<DashboardCatalogStateRecord> {
    const existing = await ctx.db
        .query('dashboardCatalogStates')
        .withIndex('by_key', (query) => query.eq('key', dashboardCatalogStateKey))
        .unique();

    if (existing) {
        const state = {
            updatedAt: now,
            version: existing.version + 1,
        };
        await ctx.db.patch('dashboardCatalogStates', existing._id, state);
        return state;
    }

    const state = {
        key: dashboardCatalogStateKey,
        updatedAt: now,
        version: 1,
    };
    await ctx.db.insert('dashboardCatalogStates', state);

    return {
        updatedAt: state.updatedAt,
        version: state.version,
    };
}
