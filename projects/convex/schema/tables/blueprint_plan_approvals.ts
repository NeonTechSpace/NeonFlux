import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, timestamp } from '../shared.js';

export const blueprintPlanApprovalsTable = defineTable({
    approvedCapabilityFingerprint: optionalString,
    approvedAt: timestamp,
    approvedByUserId: optionalString,
    approvedStructureFingerprint: optionalString,
    confirmationMethod: v.optional(v.union(v.literal('acknowledgement'), v.literal('target_name'))),
    deleteSetDigest: optionalString,
    destructiveStepCount: v.optional(v.number()),
    destructiveApprovedAt: v.optional(timestamp),
    destructivePreflightDigest: optionalString,
    fingerprintVersion: v.optional(v.literal(2)),
    planDigest: v.string(),
    planId: v.id('blueprintPlans'),
}).index('by_plan_approved', ['planId', 'approvedAt']);
