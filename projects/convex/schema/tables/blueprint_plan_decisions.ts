import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, timestamp } from '../shared.js';

export const blueprintPlanDecisionsTable = defineTable({
    createdAt: timestamp,
    decision: jsonValue,
    planId: v.id('blueprintPlans'),
    sequence: v.number(),
}).index('by_plan_sequence', ['planId', 'sequence']);
