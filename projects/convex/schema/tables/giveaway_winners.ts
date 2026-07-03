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

export const giveawayWinnersTable = defineTable({
    drawNumber: v.number(),
    giveawayLegacyId: v.string(),
    legacyId: v.string(),
    selectedAt: timestamp,
    userId: v.string(),
})
    .index('by_legacy', ['legacyId'])
    .index('by_giveaway_draw', ['giveawayLegacyId', 'drawNumber'])
    .index('by_giveaway_user_draw', ['giveawayLegacyId', 'userId', 'drawNumber']);
