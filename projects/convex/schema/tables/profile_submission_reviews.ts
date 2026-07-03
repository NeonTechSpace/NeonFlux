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

export const profileSubmissionReviewsTable = defineTable({
    createdAt: timestamp,
    decision: v.union(v.literal('approved'), v.literal('rejected')),
    legacyId: v.string(),
    reason: optionalString,
    reviewerUserId: v.string(),
    submissionLegacyId: v.string(),
})
    .index('by_legacy', ['legacyId'])
    .index('by_submission', ['submissionLegacyId']);
