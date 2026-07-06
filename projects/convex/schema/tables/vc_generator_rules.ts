import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const vcGeneratorRulesTable = defineTable({
    categoryId: optionalString,
    config: jsonValue,
    createdAt: timestamp,
    enabled: v.boolean(),
    guildId: v.string(),
    nameTemplate: v.string(),
    sourceChannelId: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_enabled_created', ['guildId', 'enabled', 'createdAt'])
    .index('by_guild_source', ['guildId', 'sourceChannelId']);
