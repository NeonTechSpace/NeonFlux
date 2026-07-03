import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
    encryptedOAuthTokenPayload,
    jsonValue,
    optionalNumber,
    optionalString,
    optionalTimestamp,
    timestamp,
} from '../shared.js';

export const ticketMembersTable = defineTable({
    createdAt: timestamp,
    legacyId: v.string(),
    role: v.string(),
    ticketLegacyId: v.string(),
    userId: v.string(),
})
    .index('by_legacy', ['legacyId'])
    .index('by_ticket_user', ['ticketLegacyId', 'userId']);
