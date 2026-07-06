import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, timestamp } from '../shared.js';

export const autoroleRulesTable = defineTable({
    createdAt: timestamp,
    enabled: v.boolean(),
    guildId: v.string(),
    name: optionalString,
    roleId: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_enabled', ['guildId', 'enabled'])
    .index('by_guild_enabled_role', ['guildId', 'enabled', 'roleId'])
    .index('by_guild_role', ['guildId', 'roleId']);
