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

export const guildMessageActivityDaysTable = defineTable({
    activityDate: v.string(),
    channelId: v.string(),
    guildId: v.string(),
    legacyId: v.string(),
    messageCount: v.number(),
    updatedAt: timestamp,
})
    .index('by_guild_channel_date', ['guildId', 'channelId', 'activityDate'])
    .index('by_guild_date', ['guildId', 'activityDate'])
    .index('by_legacy', ['legacyId']);
