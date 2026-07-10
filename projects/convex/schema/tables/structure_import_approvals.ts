import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, timestamp } from '../shared.js';

export const structureImportApprovalsTable = defineTable({
    approvedAt: timestamp,
    approvedByUserId: optionalString,
    deleteSetDigest: optionalString,
    destructiveActionCount: v.optional(v.number()),
    destructiveApprovedAt: v.optional(timestamp),
    destructivePreflightDigest: optionalString,
    planDigest: v.string(),
    runId: v.id('structureImportRuns'),
}).index('by_run_approved', ['runId', 'approvedAt']);
