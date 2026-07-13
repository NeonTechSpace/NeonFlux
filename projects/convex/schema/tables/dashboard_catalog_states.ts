import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const dashboardCatalogStatesTable = defineTable({
    key: v.string(),
    updatedAt: v.string(),
    version: v.number(),
}).index('by_key', ['key']);
