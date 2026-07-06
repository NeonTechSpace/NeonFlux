import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const xpRoleRewardsTable = defineTable({
    createdAt: timestamp,
    guildId: v.string(),
    level: v.number(),
    roleId: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_level_role', ['guildId', 'level', 'roleId'])
    .index('by_guild_role', ['guildId', 'roleId']);
