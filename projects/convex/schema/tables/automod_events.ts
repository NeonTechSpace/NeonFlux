import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const automodEventsTable = defineTable({
    actionType: v.union(v.literal('record'), v.literal('delete_message'), v.literal('timeout'), v.literal('warn')),
    authorUserId: v.string(),
    channelId: v.string(),
    createdAt: timestamp,
    details: jsonValue,
    guildId: v.string(),
    legacyId: v.string(),
    messageId: v.string(),
    ruleLegacyId: optionalString,
    status: v.string(),
    triggerType: v.union(v.literal('blocked_terms'), v.literal('invite_links')),
})
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_message', ['guildId', 'messageId'])
    .index('by_legacy', ['legacyId'])
    .index('by_rule_created', ['ruleLegacyId', 'createdAt']);
