import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonValue, optionalString, timestamp } from '../shared.js';

export const moderationCaseEventsTable = defineTable({
    actorUserId: optionalString,
    caseId: v.id('moderationCases'),
    createdAt: timestamp,
    details: jsonValue,
    eventType: v.string(),
})
    .index('by_case', ['caseId'])
    .index('by_case_created', ['caseId', 'createdAt']);
