import { moderationCasesTable } from './tables/moderation_cases.js';
import { moderationCaseCountersTable } from './tables/moderation_case_counters.js';
import { moderationCaseEventsTable } from './tables/moderation_case_events.js';
import { moderationTemporaryActionsTable } from './tables/moderation_temporary_actions.js';

export const moderationTables = {
    moderationCases: moderationCasesTable,
    moderationCaseCounters: moderationCaseCountersTable,
    moderationCaseEvents: moderationCaseEventsTable,
    moderationTemporaryActions: moderationTemporaryActionsTable,
};
