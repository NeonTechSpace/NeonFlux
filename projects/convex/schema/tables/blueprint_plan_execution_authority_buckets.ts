import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

const blueprintEntityKind = v.union(v.literal('role'), v.literal('category'), v.literal('channel'));

export const blueprintPlanExecutionAuthorityBucketsTable = defineTable({
    bucket: v.number(),
    bucketDigest: v.string(),
    createdAt: timestamp,
    guildId: v.string(),
    knownTargetKinds: v.record(v.string(), blueprintEntityKind),
    planId: v.id('blueprintPlans'),
    sourceTargetMap: v.record(v.string(), v.union(v.string(), v.null())),
    version: v.literal(1),
})
    .index('by_plan', ['planId'])
    .index('by_plan_bucket', ['planId', 'bucket']);
