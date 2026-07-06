import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const roleReconciliationActionsTable = defineTable({
    actionType: v.string(),
    createdAt: timestamp,
    details: jsonValue,
    roleId: optionalString,
    runId: v.id('roleReconciliationRuns'),
    status: v.string(),
    updatedAt: timestamp,
})
    .index('by_run_created', ['runId', 'createdAt'])
    .index('by_run_status', ['runId', 'status']);
