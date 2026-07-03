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

export const guildLoggingDestinationsTable = defineTable({
    channelId: v.string(),
    createdAt: timestamp,
    enabled: v.boolean(),
    eventGroup: v.string(),
    guildId: v.string(),
    legacyId: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_enabled', ['guildId', 'enabled'])
    .index('by_guild_group', ['guildId', 'eventGroup']);
