import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const blueprintRunCursorsTable = defineTable({
    mappingCount: v.number(),
    planId: v.id('blueprintPlans'),
    runId: v.id('blueprintRuns'),
    updatedAt: timestamp,
    version: v.literal(1),
})
    .index('by_run', ['runId'])
    .index('by_plan', ['planId']);
