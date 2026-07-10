import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { optionalString, timestamp } from '../shared.js';

export const reactionRoleReconciliationItemsTable = defineTable({
    assignmentId: v.id('reactionRoleAssignments'),
    attemptCount: v.number(),
    createdAt: timestamp,
    emojiKey: v.string(),
    errorCode: optionalString,
    operationId: v.id('reactionRoleOperations'),
    outcome: optionalString,
    roleId: v.string(),
    status: v.string(),
    updatedAt: timestamp,
    userId: v.string(),
})
    .index('by_operation_assignment', ['operationId', 'assignmentId'])
    .index('by_operation_status', ['operationId', 'status', 'createdAt']);
