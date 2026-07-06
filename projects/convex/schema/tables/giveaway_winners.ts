import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const giveawayWinnersTable = defineTable({
    drawNumber: v.number(),
    giveawayId: v.id('giveaways'),
    selectedAt: timestamp,
    userId: v.string(),
})
    .index('by_giveaway_draw', ['giveawayId', 'drawNumber'])
    .index('by_giveaway_user_draw', ['giveawayId', 'userId', 'drawNumber']);
