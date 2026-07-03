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

export const giveawayEntriesTable = defineTable({
    enteredAt: timestamp,
    giveawayLegacyId: v.string(),
    legacyId: v.string(),
    removedAt: optionalTimestamp,
    userId: v.string(),
})
    .index('by_legacy', ['legacyId'])
    .index('by_giveaway_removed', ['giveawayLegacyId', 'removedAt'])
    .index('by_giveaway_user', ['giveawayLegacyId', 'userId']);
