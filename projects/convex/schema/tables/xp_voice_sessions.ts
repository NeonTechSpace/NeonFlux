import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
    encryptedOAuthTokenPayload,
    jsonValue,
    optionalNumber,
    optionalString,
    optionalTimestamp,
    timestamp,
} from '../shared.js';

export const xpVoiceSessionsTable = defineTable({
    channelId: v.string(),
    createdAt: timestamp,
    creditedSeconds: v.number(),
    endedAt: optionalTimestamp,
    guildId: v.string(),
    legacyId: v.string(),
    startedAt: timestamp,
    status: v.union(v.literal('active'), v.literal('closed')),
    updatedAt: timestamp,
    userId: v.string(),
})
    .index('by_guild_status_started', ['guildId', 'status', 'startedAt'])
    .index('by_guild_user_status', ['guildId', 'userId', 'status'])
    .index('by_legacy', ['legacyId']);
