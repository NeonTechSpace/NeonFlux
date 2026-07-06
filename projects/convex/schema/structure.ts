import { structureBackupSettingsTable } from './tables/structure_backup_settings.js';
import { structureBackupsTable } from './tables/structure_backups.js';
import { structureImportRunsTable } from './tables/structure_import_runs.js';
import { structureImportActionsTable } from './tables/structure_import_actions.js';

export const structureTables = {
    structureBackups: structureBackupsTable,
    structureBackupSettings: structureBackupSettingsTable,
    structureImportRuns: structureImportRunsTable,
    structureImportActions: structureImportActionsTable,
};
