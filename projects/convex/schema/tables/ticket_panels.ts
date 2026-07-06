import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const ticketPanelsTable = defineTable({
    channelId: v.string(),
    config: jsonValue,
    createdAt: timestamp,
    enabled: v.boolean(),
    guildId: v.string(),
    messageId: optionalString,
    title: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_enabled', ['guildId', 'enabled'])
    .index('by_guild_message', ['guildId', 'messageId']);
