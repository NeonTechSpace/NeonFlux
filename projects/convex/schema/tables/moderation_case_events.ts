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

export const moderationCaseEventsTable = defineTable({
    actorUserId: optionalString,
    caseLegacyId: v.string(),
    createdAt: timestamp,
    details: jsonValue,
    eventType: v.string(),
    legacyId: v.string(),
})
    .index('by_case', ['caseLegacyId'])
    .index('by_case_created', ['caseLegacyId', 'createdAt'])
    .index('by_legacy', ['legacyId']);
