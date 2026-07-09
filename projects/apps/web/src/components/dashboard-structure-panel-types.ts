import type { DashboardStructureExplorerComparisonTarget } from './dashboard-structure-explorer.js';
import type {
    DashboardStructureBackupSummary,
    DashboardStructureDriftResult,
    DashboardStructureImportAction,
} from '../server/dashboard-structure.server.js';

export type PanelStatus = {
    tone: 'success' | 'error' | 'neutral';
    message: string;
};

export type ActionPageState = {
    actions: DashboardStructureImportAction[];
    nextCursor?: string;
};

export type BackupPageState = {
    backups: DashboardStructureBackupSummary[];
    nextCursor?: string;
};

export type DriftState = Extract<DashboardStructureDriftResult, { type: 'structure-drift' }>;

export const emptyExplorerComparisonTarget: DashboardStructureExplorerComparisonTarget = {
    label: 'No comparison',
    type: 'none',
};

export const emptyPlanSummary = {
    creates: 0,
    updates: 0,
    deletes: 0,
    roles: 0,
    categories: 0,
    channels: 0,
};
