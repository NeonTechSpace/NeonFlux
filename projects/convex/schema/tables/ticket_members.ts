import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const ticketMembersTable = defineTable({
    createdAt: timestamp,
    role: v.string(),
    ticketId: v.id('tickets'),
    userId: v.string(),
}).index('by_ticket_user', ['ticketId', 'userId']);
