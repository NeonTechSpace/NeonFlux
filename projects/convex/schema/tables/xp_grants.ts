import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, timestamp } from '../shared.js';

export const xpGrantsTable = defineTable({
    grantedAt: timestamp,
    guildId: v.string(),
    idempotencyKey: v.string(),
    legacyId: v.string(),
    levelAfter: v.number(),
    levelBefore: v.number(),
    metadata: jsonValue,
    source: v.union(v.literal('message'), v.literal('voice')),
    userId: v.string(),
    xp: v.number(),
})
    .index('by_guild_key', ['guildId', 'idempotencyKey'])
    .index('by_guild_source_granted', ['guildId', 'source', 'grantedAt'])
    .index('by_guild_user_granted', ['guildId', 'userId', 'grantedAt'])
    .index('by_legacy', ['legacyId']);
