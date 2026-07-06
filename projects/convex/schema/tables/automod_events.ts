import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, timestamp } from '../shared.js';

export const automodEventsTable = defineTable({
    actionType: v.union(v.literal('record'), v.literal('delete_message'), v.literal('timeout'), v.literal('warn')),
    authorUserId: v.string(),
    channelId: v.string(),
    createdAt: timestamp,
    details: jsonValue,
    guildId: v.string(),
    messageId: v.string(),
    ruleId: v.optional(v.id('automodRules')),
    status: v.string(),
    triggerType: v.literal('blocked_terms'),
})
    .index('by_guild_created', ['guildId', 'createdAt'])
    .index('by_guild_message', ['guildId', 'messageId'])
    .index('by_rule_created', ['ruleId', 'createdAt']);
