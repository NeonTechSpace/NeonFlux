import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalTimestamp, timestamp } from '../shared.js';

export const reactionRoleAssignmentsTable = defineTable({
    assignedAt: timestamp,
    desiredState: v.optional(v.string()),
    emojiKey: v.string(),
    guildId: v.string(),
    messageId: v.string(),
    reactionRoleMessageId: v.optional(v.id('reactionRoleMessages')),
    removedAt: optionalTimestamp,
    roleId: v.string(),
    status: v.optional(v.string()),
    updatedAt: v.optional(timestamp),
    userId: v.string(),
})
    .index('by_guild_role', ['guildId', 'roleId'])
    .index('by_guild_message_user', ['guildId', 'messageId', 'userId'])
    .index('by_guild_message_user_removed', ['guildId', 'messageId', 'userId', 'removedAt'])
    .index('by_guild_message_user_role', ['guildId', 'messageId', 'userId', 'roleId'])
    .index('by_guild_user', ['guildId', 'userId'])
    .index('by_guild_user_removed', ['guildId', 'userId', 'removedAt'])
    .index('by_guild_user_role_removed', ['guildId', 'userId', 'roleId', 'removedAt'])
    .index('by_guild_user_role_desired_removed', ['guildId', 'userId', 'roleId', 'desiredState', 'removedAt'])
    .index('by_message', ['reactionRoleMessageId'])
    .index('by_message_user', ['reactionRoleMessageId', 'userId'])
    .index('by_message_user_emoji', ['reactionRoleMessageId', 'userId', 'emojiKey'])
    .index('by_removed_at', ['removedAt'])
    .index('by_status', ['status']);
