import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, optionalTimestamp, timestamp } from '../shared.js';

export const blueprintRunStepAttemptsTable = defineTable({
    actionType: v.union(v.literal('create'), v.literal('update'), v.literal('delete')),
    planStepId: v.id('blueprintPlanSteps'),
    attempt: v.number(),
    completedAt: optionalTimestamp,
    completionDigest: optionalString,
    createdAt: timestamp,
    createdId: optionalString,
    errorType: optionalString,
    displayLabel: v.string(),
    planStepSequence: v.number(),
    sourceId: optionalString,
    stepDigest: v.string(),
    targetId: v.string(),
    targetType: v.union(
        v.literal('role'),
        v.literal('category'),
        v.literal('channel'),
        v.literal('role-order'),
        v.literal('channel-order')
    ),
    runId: v.id('blueprintRuns'),
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
    .index('by_run_plan_step_attempt', ['runId', 'planStepId', 'attempt'])
    .index('by_run_state', ['runId', 'state']);
