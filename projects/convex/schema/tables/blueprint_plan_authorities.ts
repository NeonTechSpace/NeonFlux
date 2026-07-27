import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const blueprintPlanAuthoritiesTable = defineTable({
    artifactBytes: v.number(),
    artifactChunkCount: v.number(),
    artifactContentDigest: v.string(),
    artifactVersion: v.literal(1),
    authorityDigest: v.string(),
    createdAt: timestamp,
    guildId: v.string(),
    planId: v.id('blueprintPlans'),
    version: v.literal(1),
}).index('by_plan', ['planId']);
