import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, timestamp } from '../shared.js';

export const suggestionBoardsTable = defineTable({
    channelId: v.string(),
    config: jsonValue,
    createdAt: timestamp,
    enabled: v.boolean(),
    guildId: v.string(),
    name: v.string(),
    updatedAt: timestamp,
})
    .index('by_guild_enabled_name_created', ['guildId', 'enabled', 'name', 'createdAt'])
    .index('by_guild_name', ['guildId', 'name'])
    .index('by_guild_name_created', ['guildId', 'name', 'createdAt']);
