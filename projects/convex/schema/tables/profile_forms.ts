import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const profileFormsTable = defineTable({
    approvalRequired: v.boolean(),
    config: jsonValue,
    createdAt: timestamp,
    enabled: v.boolean(),
    guildId: v.string(),
    legacyId: v.string(),
    name: v.string(),
    outputChannelId: optionalString,
    updatedAt: timestamp,
})
    .index('by_guild_enabled_name', ['guildId', 'enabled', 'name'])
    .index('by_guild_name', ['guildId', 'name'])
    .index('by_legacy', ['legacyId']);
