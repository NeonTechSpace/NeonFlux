import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, timestamp } from '../shared.js';

export const blueprintRunVerificationEvidenceTable = defineTable({
    createdAt: timestamp,
    planId: v.id('blueprintPlans'),
    result: jsonValue,
    runId: v.id('blueprintRuns'),
    verificationEvidenceDigest: v.string(),
    verificationStatus: v.union(v.literal('matched'), v.literal('mismatch'), v.literal('read_failed')),
    version: v.literal(1),
})
    .index('by_run', ['runId'])
    .index('by_plan_created', ['planId', 'createdAt']);
