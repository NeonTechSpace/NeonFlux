import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, optionalTimestamp, timestamp } from '../shared.js';

export const blueprintRunStepAttemptsTable = defineTable({
    planStepId: v.id('blueprintPlanSteps'),
    attempt: v.number(),
    completedAt: optionalTimestamp,
    createdAt: timestamp,
    createdId: optionalString,
    errorType: optionalString,
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
