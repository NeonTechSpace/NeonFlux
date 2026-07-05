import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, optionalTimestamp, timestamp } from '../shared.js';

export const vcGeneratorControlPanelsTable = defineTable({
    channelId: v.string(),
    config: jsonValue,
    controlMode: v.string(),
    createdAt: timestamp,
    guildId: v.string(),
    lastSyncedAt: optionalTimestamp,
    legacyId: v.string(),
    messageId: optionalString,
    ruleLegacyId: v.string(),
    staleAt: optionalTimestamp,
    status: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_message', ['guildId', 'messageId'])
    .index('by_guild_rule', ['guildId', 'ruleLegacyId'])
    .index('by_guild_status', ['guildId', 'status'])
    .index('by_legacy', ['legacyId']);
