import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const dashboardLiveStatesTable = defineTable({
    area: v.string(),
    guildId: v.string(),
    updatedAt: v.string(),
    version: v.number(),
}).index('by_guild_area', ['guildId', 'area']);
