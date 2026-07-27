import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const blueprintPlanAuthorityChunksTable = defineTable({
    authorityId: v.id('blueprintPlanAuthorities'),
    byteLength: v.number(),
    canonicalJsonChunk: v.string(),
    chunkDigest: v.string(),
    createdAt: timestamp,
    guildId: v.string(),
    planId: v.id('blueprintPlans'),
    sequence: v.number(),
})
    .index('by_authority', ['authorityId'])
    .index('by_authority_sequence', ['authorityId', 'sequence'])
    .index('by_plan', ['planId']);
