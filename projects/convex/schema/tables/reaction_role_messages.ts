import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, optionalTimestamp, timestamp } from '../shared.js';

export const reactionRoleMessagesTable = defineTable({
    channelId: v.string(),
    createdAt: timestamp,
    enabled: v.boolean(),
    generateOverview: v.boolean(),
    guildId: v.string(),
    kind: v.string(),
    legacyId: v.string(),
    messageContent: optionalString,
    messageEmbeds: v.array(v.any()),
    messageId: v.string(),
    mode: v.string(),
    source: v.string(),
    staleAt: optionalTimestamp,
    updatedAt: timestamp,
})
    .index('by_guild_channel_message', ['guildId', 'channelId', 'messageId'])
    .index('by_guild_enabled', ['guildId', 'enabled'])
    .index('by_guild_message', ['guildId', 'messageId'])
    .index('by_legacy', ['legacyId']);
