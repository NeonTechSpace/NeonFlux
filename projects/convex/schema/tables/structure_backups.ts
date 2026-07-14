import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const structureBackupsTable = defineTable({
    categoryCount: v.number(),
    channelCount: v.number(),
    completedAt: timestamp,
    createdAt: timestamp,
    createdByUserId: optionalString,
    errorMessage: optionalString,
    guildId: v.string(),
    name: v.string(),
    roleCount: v.number(),
    sortKey: v.string(),
    source: v.union(v.literal('manual'), v.literal('scheduled'), v.literal('restore_point')),
    status: v.union(v.literal('succeeded'), v.literal('failed')),
    structure: v.optional(jsonValue),
})
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_source_status_sort_key', ['guildId', 'source', 'status', 'sortKey'])
    .index('by_guild_sort_key', ['guildId', 'sortKey']);
