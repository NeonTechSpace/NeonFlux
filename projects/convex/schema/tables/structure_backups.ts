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
    source: v.string(),
    status: v.string(),
    structure: v.optional(jsonValue),
})
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_sort_key', ['guildId', 'sortKey']);
