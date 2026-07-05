import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const giveawayEventsTable = defineTable({
    actorUserId: optionalString,
    createdAt: timestamp,
    details: jsonValue,
    eventType: v.string(),
    giveawayLegacyId: v.string(),
    legacyId: v.string(),
})
    .index('by_giveaway_created', ['giveawayLegacyId', 'createdAt'])
    .index('by_legacy', ['legacyId']);
