import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalTimestamp, timestamp } from '../shared.js';

export const giveawayEntriesTable = defineTable({
    enteredAt: timestamp,
    giveawayId: v.id('giveaways'),
    removedAt: optionalTimestamp,
    userId: v.string(),
})
    .index('by_giveaway_removed', ['giveawayId', 'removedAt'])
    .index('by_giveaway_user', ['giveawayId', 'userId']);
