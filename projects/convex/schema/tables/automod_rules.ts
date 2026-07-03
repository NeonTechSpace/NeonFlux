import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
    encryptedOAuthTokenPayload,
    jsonValue,
    optionalNumber,
    optionalString,
    optionalTimestamp,
    timestamp,
} from '../shared.js';

export const automodRulesTable = defineTable({
    actionType: v.union(v.literal('record'), v.literal('delete_message'), v.literal('timeout'), v.literal('warn')),
    config: jsonValue,
    createdAt: timestamp,
    enabled: v.boolean(),
    guildId: v.string(),
    legacyId: v.string(),
    name: v.string(),
    triggerType: v.union(v.literal('blocked_terms'), v.literal('invite_links')),
    updatedAt: timestamp,
})
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_enabled_created', ['guildId', 'enabled', 'createdAt'])
    .index('by_guild_enabled', ['guildId', 'enabled'])
    .index('by_guild_legacy', ['guildId', 'legacyId'])
    .index('by_guild_name', ['guildId', 'name'])
    .index('by_guild_trigger', ['guildId', 'triggerType'])
    .index('by_legacy', ['legacyId']);
