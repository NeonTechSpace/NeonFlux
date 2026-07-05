import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, timestamp } from '../shared.js';

export const roleReconciliationRunsTable = defineTable({
    createdAt: timestamp,
    guildId: v.string(),
    legacyId: v.string(),
    status: v.string(),
    summary: jsonValue,
    updatedAt: timestamp,
})
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_status', ['guildId', 'status'])
    .index('by_legacy', ['legacyId']);
