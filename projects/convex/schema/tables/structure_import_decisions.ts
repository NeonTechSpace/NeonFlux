import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const structureImportDecisionsTable = defineTable({
    classification: v.string(),
    createdAt: timestamp,
    details: jsonValue,
    logicalId: optionalString,
    name: optionalString,
    runId: v.id('structureImportRuns'),
    sequence: v.number(),
    sourceId: optionalString,
    targetId: optionalString,
    targetType: v.string(),
}).index('by_run_sequence', ['runId', 'sequence']);
