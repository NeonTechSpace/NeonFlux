import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const verificationFlowsTable = defineTable({
    channelId: v.string(),
    createdAt: timestamp,
    emojiKey: v.string(),
    enabled: v.boolean(),
    guildId: v.string(),
    messageId: v.string(),
    updatedAt: timestamp,
    verifiedRoleId: v.string(),
})
    .index('by_guild_enabled', ['guildId', 'enabled'])
    .index('by_guild_message', ['guildId', 'messageId'])
    .index('by_guild_message_emoji_enabled', ['guildId', 'messageId', 'emojiKey', 'enabled'])
    .index('by_guild_role', ['guildId', 'verifiedRoleId'])
    .index('by_guild_channel_message', ['guildId', 'channelId', 'messageId']);
