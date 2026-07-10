import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const reactionRoleOptionsTable = defineTable({
    createdAt: timestamp,
    emojiKey: v.string(),
    position: v.number(),
    reactionRoleMessageId: v.id('reactionRoleMessages'),
    roleId: v.string(),
    updatedAt: timestamp,
})
    .index('by_message_emoji', ['reactionRoleMessageId', 'emojiKey'])
    .index('by_message_position', ['reactionRoleMessageId', 'position', 'emojiKey'])
    .index('by_message_role', ['reactionRoleMessageId', 'roleId'])
    .index('by_role', ['roleId']);
