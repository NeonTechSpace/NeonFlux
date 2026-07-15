import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const blueprintPlanExecutionAuthoritiesTable = defineTable({
    bucketCount: v.literal(64),
    bucketDigests: v.array(v.string()),
    contentDigest: v.string(),
    createdAt: timestamp,
    executionAuthorityDigest: v.string(),
    guildId: v.string(),
    planId: v.id('blueprintPlans'),
    sourceGuildId: v.optional(v.string()),
    version: v.literal(1),
}).index('by_plan', ['planId']);
