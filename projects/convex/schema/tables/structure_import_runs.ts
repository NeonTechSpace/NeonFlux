import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, optionalTimestamp, timestamp } from '../shared.js';

export const structureImportRunsTable = defineTable({
    appliedAt: optionalTimestamp,
    confirmedAt: optionalTimestamp,
    createdAt: timestamp,
    createdByUserId: optionalString,
    guildId: v.string(),
    plan: jsonValue,
    sourceBackupId: v.optional(v.id('structureBackups')),
    status: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_status', ['guildId', 'status']);
