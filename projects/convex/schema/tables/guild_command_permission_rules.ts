import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const guildCommandPermissionRulesTable = defineTable({
    createdAt: timestamp,
    guildId: v.string(),
    legacyId: v.string(),
    roleIds: v.array(v.string()),
    targetId: v.string(),
    targetType: v.union(v.literal('category'), v.literal('command')),
    updatedAt: timestamp,
    userIds: v.array(v.string()),
})
    .index('by_guild', ['guildId'])
    .index('by_guild_target', ['guildId', 'targetType', 'targetId']);
