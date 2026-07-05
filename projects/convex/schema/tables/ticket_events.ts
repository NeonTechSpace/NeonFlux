import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const ticketEventsTable = defineTable({
    actorUserId: optionalString,
    createdAt: timestamp,
    details: jsonValue,
    eventType: v.string(),
    legacyId: v.string(),
    ticketLegacyId: v.string(),
})
    .index('by_legacy', ['legacyId'])
    .index('by_ticket_created', ['ticketLegacyId', 'createdAt']);
