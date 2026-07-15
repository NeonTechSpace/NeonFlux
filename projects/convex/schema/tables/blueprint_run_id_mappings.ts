import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { timestamp } from '../shared.js';

export const blueprintRunIdMappingsTable = defineTable({
    createdAt: timestamp,
    planId: v.id('blueprintPlans'),
    runId: v.id('blueprintRuns'),
    sourceId: v.string(),
    targetId: v.string(),
    version: v.literal(1),
})
    .index('by_run', ['runId'])
    .index('by_run_source', ['runId', 'sourceId'])
    .index('by_run_target', ['runId', 'targetId'])
    .index('by_plan', ['planId']);
