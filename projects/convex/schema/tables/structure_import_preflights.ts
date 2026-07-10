import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, timestamp } from '../shared.js';

export const structureImportPreflightsTable = defineTable({
    checkedAt: timestamp,
    expiresAt: timestamp,
    liveFingerprint: v.string(),
    planDigest: v.string(),
    preflightDigest: v.string(),
    report: jsonValue,
    runId: v.id('structureImportRuns'),
    status: v.union(v.literal('ready'), v.literal('blocked'), v.literal('stale')),
}).index('by_run_checked', ['runId', 'checkedAt']);
