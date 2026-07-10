import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, optionalTimestamp, timestamp } from '../shared.js';

export const structureImportActionAttemptsTable = defineTable({
    actionId: v.id('structureImportActions'),
    attempt: v.number(),
    completedAt: optionalTimestamp,
    createdAt: timestamp,
    createdId: optionalString,
    errorType: optionalString,
    executionId: v.id('structureImportExecutions'),
    requestKey: v.string(),
    retryAt: optionalTimestamp,
    startedAt: optionalTimestamp,
    state: v.union(
        v.literal('pending'),
        v.literal('started'),
        v.literal('applied'),
        v.literal('failed'),
        v.literal('unknown')
    ),
    updatedAt: timestamp,
})
    .index('by_execution_action_attempt', ['executionId', 'actionId', 'attempt'])
    .index('by_execution_state', ['executionId', 'state']);
