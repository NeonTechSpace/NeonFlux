import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalTimestamp, timestamp } from '../shared.js';

export const guildGrowthDailyAggregatesTable = defineTable({
    activityDate: v.string(),
    firstEventAt: optionalTimestamp,
    guildId: v.string(),
    joins: v.number(),
    leaves: v.number(),
    messageCount: v.number(),
    shard: v.number(),
    updatedAt: timestamp,
})
    .index('by_guild_date', ['guildId', 'activityDate'])
    .index('by_guild_date_shard', ['guildId', 'activityDate', 'shard'])
    .index('by_guild_first_event', ['guildId', 'firstEventAt'])
    .index('by_date', ['activityDate']);
