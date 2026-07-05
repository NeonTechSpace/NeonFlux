import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const reactionRoleOptionsTable = defineTable({
    createdAt: timestamp,
    emojiKey: v.string(),
    legacyId: v.string(),
    position: v.number(),
    reactionRoleMessageLegacyId: v.string(),
    roleId: v.string(),
    updatedAt: timestamp,
})
    .index('by_legacy', ['legacyId'])
    .index('by_message_emoji', ['reactionRoleMessageLegacyId', 'emojiKey'])
    .index('by_message_position', ['reactionRoleMessageLegacyId', 'position', 'emojiKey'])
    .index('by_role', ['roleId']);
