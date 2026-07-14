import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const structureImportRunsTable = defineTable({
    createdAt: timestamp,
    createdByUserId: optionalString,
    guildId: v.string(),
    deleteActionCount: v.number(),
    deleteSetDigest: optionalString,
    planDigest: v.string(),
    planVersion: v.number(),
    policy: v.union(v.literal('merge'), v.literal('synchronize'), v.literal('rebuild')),
    plan: jsonValue,
    requestedSnapshotDigest: v.string(),
    sourceBackupId: v.optional(v.id('structureBackups')),
    status: v.union(
        v.literal('building'),
        v.literal('needs_mapping'),
        v.literal('review_ready'),
        v.literal('approved'),
        v.literal('stale')
    ),
    updatedAt: timestamp,
})
    .index('by_updated', ['updatedAt'])
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_status', ['guildId', 'status']);
