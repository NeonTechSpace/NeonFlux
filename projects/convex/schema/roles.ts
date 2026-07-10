import { reactionRoleMessagesTable } from './tables/reaction_role_messages.js';
import { reactionRoleOptionsTable } from './tables/reaction_role_options.js';
import { reactionRoleAssignmentsTable } from './tables/reaction_role_assignments.js';
import { reactionRoleMemberStatesTable } from './tables/reaction_role_member_states.js';
import { reactionRoleOperationsTable } from './tables/reaction_role_operations.js';
import { reactionRoleReconciliationItemsTable } from './tables/reaction_role_reconciliation_items.js';
import { reactionRoleUserLeasesTable } from './tables/reaction_role_user_leases.js';

export const roleTables = {
    reactionRoleMessages: reactionRoleMessagesTable,
    reactionRoleOptions: reactionRoleOptionsTable,
    reactionRoleAssignments: reactionRoleAssignmentsTable,
    reactionRoleMemberStates: reactionRoleMemberStatesTable,
    reactionRoleOperations: reactionRoleOperationsTable,
    reactionRoleReconciliationItems: reactionRoleReconciliationItemsTable,
    reactionRoleUserLeases: reactionRoleUserLeasesTable,
};
