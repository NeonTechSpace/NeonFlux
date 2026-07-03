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

export const suggestionVotesTable = defineTable({
    createdAt: timestamp,
    legacyId: v.string(),
    suggestionLegacyId: v.string(),
    updatedAt: timestamp,
    userId: v.string(),
    vote: v.union(v.literal('down'), v.literal('up')),
})
    .index('by_legacy', ['legacyId'])
    .index('by_suggestion_user', ['suggestionLegacyId', 'userId']);
