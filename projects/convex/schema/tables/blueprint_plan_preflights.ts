import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, timestamp } from '../shared.js';

export const blueprintPlanPreflightsTable = defineTable({
    capabilityFingerprint: v.string(),
    checkedAt: timestamp,
    expiresAt: timestamp,
    fingerprintVersion: v.literal(2),
    mutationFenceManifestJson: v.string(),
    observationSource: v.literal('resident-client'),
    observedAt: timestamp,
    planDigest: v.string(),
    preflightDigest: v.string(),
    report: jsonValue,
    planId: v.id('blueprintPlans'),
    status: v.union(v.literal('ready'), v.literal('blocked'), v.literal('stale')),
    structureFingerprint: v.string(),
}).index('by_plan_checked', ['planId', 'checkedAt']);
