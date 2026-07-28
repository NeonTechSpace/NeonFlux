import { reactionRoleMemberOperationsTable } from './tables/reaction_role_member_operations.js';
import { reactionRolePanelOperationsTable } from './tables/reaction_role_panel_operations.js';
import { reactionRolePanelVersionsTable } from './tables/reaction_role_panel_versions.js';
import { reactionRolePanelsTable } from './tables/reaction_role_panels.js';
import { reactionRoleSelectionsTable } from './tables/reaction_role_selections.js';
import { reactionRoleReconciliationDirtyUsersTable } from './tables/reaction_role_reconciliation_dirty_users.js';

export const reactionRoleTables = {
    reactionRoleMemberOperations: reactionRoleMemberOperationsTable,
    reactionRolePanelOperations: reactionRolePanelOperationsTable,
    reactionRolePanelVersions: reactionRolePanelVersionsTable,
    reactionRolePanels: reactionRolePanelsTable,
    reactionRoleReconciliationDirtyUsers: reactionRoleReconciliationDirtyUsersTable,
    reactionRoleSelections: reactionRoleSelectionsTable,
};
