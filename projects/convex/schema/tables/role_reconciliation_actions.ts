import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const roleReconciliationActionsTable = defineTable({
    actionType: v.string(),
    createdAt: timestamp,
    details: jsonValue,
    legacyId: v.string(),
    roleId: optionalString,
    runLegacyId: v.string(),
    status: v.string(),
    updatedAt: timestamp,
})
    .index('by_legacy', ['legacyId'])
    .index('by_run_created', ['runLegacyId', 'createdAt'])
    .index('by_run_status', ['runLegacyId', 'status']);
