import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalTimestamp, timestamp } from '../shared.js';

export const profileSubmissionsTable = defineTable({
    formLegacyId: v.string(),
    guildId: v.string(),
    legacyId: v.string(),
    reviewedAt: optionalTimestamp,
    status: v.union(v.literal('approved'), v.literal('pending'), v.literal('rejected')),
    submittedAt: timestamp,
    updatedAt: timestamp,
    userId: v.string(),
    values: jsonValue,
})
    .index('by_guild_status_submitted', ['guildId', 'status', 'submittedAt'])
    .index('by_guild_submitted', ['guildId', 'submittedAt'])
    .index('by_guild_status', ['guildId', 'status'])
    .index('by_guild_user', ['guildId', 'userId'])
    .index('by_legacy', ['legacyId']);
