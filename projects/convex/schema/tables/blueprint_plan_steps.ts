import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const blueprintPlanStepsTable = defineTable({
    actionType: v.union(v.literal('create'), v.literal('update'), v.literal('delete')),
    createdAt: timestamp,
    details: jsonValue,
    planId: v.id('blueprintPlans'),
    sequence: v.number(),
    targetId: optionalString,
    targetType: v.union(
        v.literal('role'),
        v.literal('category'),
        v.literal('channel'),
        v.literal('channel-order'),
        v.literal('role-order')
    ),
}).index('by_plan_sequence', ['planId', 'sequence']);
