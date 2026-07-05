import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const structureExportSnapshotsTable = defineTable({
    createdAt: timestamp,
    createdByUserId: optionalString,
    guildId: v.string(),
    legacyId: v.string(),
    snapshot: jsonValue,
    source: v.string(),
})
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_legacy', ['legacyId']);
