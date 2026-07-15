import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, timestamp } from '../shared.js';

export const blueprintPlanPreflightEvidenceTable = defineTable({
    createdAt: timestamp,
    evidenceDigest: v.string(),
    manifestDigest: v.string(),
    mutationFenceManifest: jsonValue,
    planId: v.id('blueprintPlans'),
    preflightId: v.id('blueprintPlanPreflights'),
    report: jsonValue,
    reportDigest: v.string(),
    version: v.literal(1),
})
    .index('by_preflight', ['preflightId'])
    .index('by_plan_created', ['planId', 'createdAt']);
