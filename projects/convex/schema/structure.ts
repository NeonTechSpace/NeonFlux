import { structureExportSnapshotsTable } from './tables/structure_export_snapshots.js';
import { structureImportRunsTable } from './tables/structure_import_runs.js';
import { structureImportActionsTable } from './tables/structure_import_actions.js';

export const structureTables = {
    structureExportSnapshots: structureExportSnapshotsTable,
    structureImportRuns: structureImportRunsTable,
    structureImportActions: structureImportActionsTable,
};
