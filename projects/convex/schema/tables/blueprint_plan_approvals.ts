import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, timestamp } from '../shared.js';

export const blueprintPlanApprovalsTable = defineTable({
    approvedAt: timestamp,
    approvedByUserId: optionalString,
    deleteSetDigest: optionalString,
    destructiveStepCount: v.optional(v.number()),
    destructiveApprovedAt: v.optional(timestamp),
    destructivePreflightDigest: optionalString,
    planDigest: v.string(),
    planId: v.id('blueprintPlans'),
}).index('by_plan_approved', ['planId', 'approvedAt']);
