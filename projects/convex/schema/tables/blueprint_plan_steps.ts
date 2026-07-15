import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, timestamp } from '../shared.js';

export const blueprintPlanStepsTable = defineTable({
    createdAt: timestamp,
    planId: v.id('blueprintPlans'),
    sequence: v.number(),
    step: jsonValue,
}).index('by_plan_sequence', ['planId', 'sequence']);
