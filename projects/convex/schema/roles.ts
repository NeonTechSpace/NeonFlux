import { guildLoggingDestinationsTable } from './tables/guild_logging_destinations.js';
import { autoroleRulesTable } from './tables/autorole_rules.js';
import { reactionRoleMessagesTable } from './tables/reaction_role_messages.js';
import { reactionRoleOptionsTable } from './tables/reaction_role_options.js';
import { reactionRoleAssignmentsTable } from './tables/reaction_role_assignments.js';
import { verificationRecordsTable } from './tables/verification_records.js';
import { verificationFlowsTable } from './tables/verification_flows.js';
import { roleReconciliationRunsTable } from './tables/role_reconciliation_runs.js';
import { roleReconciliationActionsTable } from './tables/role_reconciliation_actions.js';

export const roleTables = {
    guildLoggingDestinations: guildLoggingDestinationsTable,
    autoroleRules: autoroleRulesTable,
    reactionRoleMessages: reactionRoleMessagesTable,
    reactionRoleOptions: reactionRoleOptionsTable,
    reactionRoleAssignments: reactionRoleAssignmentsTable,
    verificationRecords: verificationRecordsTable,
    verificationFlows: verificationFlowsTable,
    roleReconciliationRuns: roleReconciliationRunsTable,
    roleReconciliationActions: roleReconciliationActionsTable,
};
