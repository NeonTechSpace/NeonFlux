import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const blueprintPlanDecisionsTable = defineTable({
    classification: v.string(),
    createdAt: timestamp,
    details: jsonValue,
    logicalId: optionalString,
    name: optionalString,
    planId: v.id('blueprintPlans'),
    sequence: v.number(),
    sourceId: optionalString,
    targetId: optionalString,
    targetType: v.string(),
}).index('by_plan_sequence', ['planId', 'sequence']);
