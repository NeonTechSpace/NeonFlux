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
    targetId: optionalString,
})
    .index('by_feature_created', ['feature', 'createdAt'])
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_feature_created', ['guildId', 'feature', 'createdAt']);
