import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const botActionEventsTable = defineTable({
    action: v.string(),
    actorUserId: optionalString,
    createdAt: timestamp,
    feature: v.string(),
    guildId: optionalString,
    metadata: jsonValue,
    sortKey: optionalString,
    targetId: optionalString,
})
    .index('by_created', ['createdAt'])
    .index('by_guild_feature_sort_key', ['guildId', 'feature', 'sortKey'])
    .index('by_guild_sort_key', ['guildId', 'sortKey'])
    .index('by_sort_key', ['sortKey']);
