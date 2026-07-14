import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, timestamp } from '../shared.js';

export const blueprintPlanPreflightsTable = defineTable({
    checkedAt: timestamp,
    expiresAt: timestamp,
    liveFingerprint: v.string(),
    planDigest: v.string(),
    preflightDigest: v.string(),
    report: jsonValue,
    planId: v.id('blueprintPlans'),
    status: v.union(v.literal('ready'), v.literal('blocked'), v.literal('stale')),
}).index('by_plan_checked', ['planId', 'checkedAt']);
