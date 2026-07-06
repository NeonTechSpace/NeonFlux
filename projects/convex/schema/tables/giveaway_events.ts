import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const giveawayEventsTable = defineTable({
    actorUserId: optionalString,
    createdAt: timestamp,
    details: jsonValue,
    eventType: v.string(),
    giveawayId: v.id('giveaways'),
}).index('by_giveaway_created', ['giveawayId', 'createdAt']);
