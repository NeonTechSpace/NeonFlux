import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const blueprintPlanPreflightsTable = defineTable({
    capabilityFingerprint: v.string(),
    checkedAt: timestamp,
    evidenceDigest: v.string(),
    evidenceVersion: v.literal(1),
    expiresAt: timestamp,
    fingerprintVersion: v.literal(2),
    guildId: v.string(),
    observationSource: v.literal('resident-client'),
    observedAt: timestamp,
    planDigest: v.string(),
    preflightDigest: v.string(),
    planId: v.id('blueprintPlans'),
    status: v.union(v.literal('ready'), v.literal('blocked'), v.literal('stale')),
    structureFingerprint: v.string(),
    summary: v.object({
        destructiveApprovalRequired: v.number(),
        invalidPlan: v.number(),
        mappingRequired: v.number(),
        ready: v.number(),
        stale: v.number(),
        total: v.number(),
        unsupported: v.number(),
    }),
}).index('by_plan_checked', ['planId', 'checkedAt']);
