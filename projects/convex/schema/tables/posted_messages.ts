import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, timestamp } from '../shared.js';

export const postedMessagesTable = defineTable({
    channelId: v.string(),
    createdAt: timestamp,
    createdByUserId: optionalString,
    guildId: v.string(),
    messageId: v.string(),
    purpose: v.string(),
    templateId: v.optional(v.id('messageTemplates')),
    updatedAt: timestamp,
})
    .index('by_guild_channel_message', ['guildId', 'channelId', 'messageId'])
    .index('by_guild_purpose', ['guildId', 'purpose']);
