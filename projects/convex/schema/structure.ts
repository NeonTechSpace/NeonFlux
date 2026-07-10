import { structureBackupSettingsTable } from './tables/structure_backup_settings.js';
import { structureBackupsTable } from './tables/structure_backups.js';
import { structureImportRunsTable } from './tables/structure_import_runs.js';
import { structureImportActionsTable } from './tables/structure_import_actions.js';
import { structureImportActionAttemptsTable } from './tables/structure_import_action_attempts.js';
import { structureImportApprovalsTable } from './tables/structure_import_approvals.js';
import { structureImportExecutionsTable } from './tables/structure_import_executions.js';
import { structureImportDecisionsTable } from './tables/structure_import_decisions.js';
import { structureImportPreflightsTable } from './tables/structure_import_preflights.js';

export const structureTables = {
    structureBackups: structureBackupsTable,
    structureBackupSettings: structureBackupSettingsTable,
    structureImportRuns: structureImportRunsTable,
    structureImportActions: structureImportActionsTable,
    structureImportActionAttempts: structureImportActionAttemptsTable,
    structureImportApprovals: structureImportApprovalsTable,
    structureImportExecutions: structureImportExecutionsTable,
    structureImportDecisions: structureImportDecisionsTable,
    structureImportPreflights: structureImportPreflightsTable,
};
