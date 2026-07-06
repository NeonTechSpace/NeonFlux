import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const ticketEventsTable = defineTable({
    actorUserId: optionalString,
    createdAt: timestamp,
    details: jsonValue,
    eventType: v.string(),
    ticketId: v.id('tickets'),
}).index('by_ticket_created', ['ticketId', 'createdAt']);
