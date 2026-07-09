import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalTimestamp, timestamp } from '../shared.js';

export const reactionRoleAssignmentsTable = defineTable({
    assignedAt: timestamp,
    emojiKey: v.string(),
    guildId: v.string(),
    messageId: v.string(),
    removedAt: optionalTimestamp,
    roleId: v.string(),
    userId: v.string(),
})
    .index('by_guild_role', ['guildId', 'roleId'])
    .index('by_guild_message_user', ['guildId', 'messageId', 'userId'])
    .index('by_guild_message_user_removed', ['guildId', 'messageId', 'userId', 'removedAt'])
    .index('by_guild_message_user_role', ['guildId', 'messageId', 'userId', 'roleId'])
    .index('by_guild_user', ['guildId', 'userId'])
    .index('by_guild_user_removed', ['guildId', 'userId', 'removedAt']);
