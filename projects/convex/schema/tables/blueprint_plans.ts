import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const blueprintPlansTable = defineTable({
    createdAt: timestamp,
    createdByUserId: optionalString,
    guildId: v.string(),
    deleteStepCount: v.number(),
    deleteSetDigest: optionalString,
    planDigest: v.string(),
    planVersion: v.number(),
    policy: v.union(v.literal('merge'), v.literal('synchronize'), v.literal('rebuild')),
    plan: jsonValue,
    requestedSnapshotDigest: v.string(),
    sourceBackupId: v.optional(v.id('structureBackups')),
    status: v.union(
        v.literal('draft'),
        v.literal('needs_input'),
        v.literal('review_ready'),
        v.literal('approved'),
        v.literal('obsolete')
    ),
    updatedAt: timestamp,
})
    .index('by_updated', ['updatedAt'])
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_status', ['guildId', 'status']);
