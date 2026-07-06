import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, timestamp } from '../shared.js';

export const profileSubmissionReviewsTable = defineTable({
    createdAt: timestamp,
    decision: v.union(v.literal('approved'), v.literal('rejected')),
    reason: optionalString,
    reviewerUserId: v.string(),
    submissionId: v.id('profileSubmissions'),
}).index('by_submission', ['submissionId']);
