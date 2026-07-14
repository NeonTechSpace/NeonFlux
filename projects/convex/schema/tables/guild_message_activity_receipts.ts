import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const guildMessageActivityReceiptsTable = defineTable({
    activityDate: v.string(),
    guildId: v.string(),
    messageId: v.string(),
    occurredAt: timestamp,
    shard: v.number(),
})
    .index('by_guild_message', ['guildId', 'messageId'])
    .index('by_occurred', ['occurredAt']);
