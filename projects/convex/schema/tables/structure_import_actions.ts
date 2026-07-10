import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const structureImportActionsTable = defineTable({
    actionType: v.union(v.literal('create'), v.literal('update'), v.literal('delete'), v.literal('noop')),
    createdAt: timestamp,
    details: jsonValue,
    runId: v.id('structureImportRuns'),
    sequence: v.number(),
    targetId: optionalString,
    targetType: v.union(
        v.literal('role'),
        v.literal('category'),
        v.literal('channel'),
        v.literal('channel-order'),
        v.literal('role-order')
    ),
}).index('by_run_sequence', ['runId', 'sequence']);
