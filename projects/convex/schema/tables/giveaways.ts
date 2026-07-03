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

export const giveawaysTable = defineTable({
    channelId: v.string(),
    closedAt: optionalTimestamp,
    closedByUserId: optionalString,
    config: jsonValue,
    createdAt: timestamp,
    createdByUserId: optionalString,
    description: optionalString,
    endsAt: optionalTimestamp,
    entryEmoji: v.string(),
    guildId: v.string(),
    legacyId: v.string(),
    messageId: optionalString,
    prize: v.string(),
    status: v.union(v.literal('active'), v.literal('cancelled'), v.literal('closed'), v.literal('draft')),
    title: v.string(),
    updatedAt: timestamp,
    winnerCount: v.number(),
})
    .index('by_ends_at', ['endsAt'])
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_message', ['guildId', 'messageId'])
    .index('by_guild_status', ['guildId', 'status'])
    .index('by_legacy', ['legacyId'])
    .index('by_status_ends', ['status', 'endsAt'])
    .index('by_status_updated', ['status', 'updatedAt']);
