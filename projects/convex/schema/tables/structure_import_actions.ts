import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const structureImportActionsTable = defineTable({
    actionType: v.string(),
    createdAt: timestamp,
    details: jsonValue,
    runId: v.id('structureImportRuns'),
    sequence: v.number(),
    status: v.string(),
    targetId: optionalString,
    targetType: v.string(),
    updatedAt: timestamp,
})
    .index('by_run_sequence', ['runId', 'sequence'])
    .index('by_run_status', ['runId', 'status']);
