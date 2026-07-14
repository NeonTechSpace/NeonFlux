import type { DashboardBlueprintExplorerComparisonTarget } from './dashboard-blueprint-explorer-types.js';
import type {
    DashboardBlueprintBackupSummary,
    DashboardBlueprintDriftResult,
    DashboardBlueprintPlanStep,
} from '../server/dashboard-blueprint-model.js';
import type { DashboardBlueprintPreflightReport } from '../server/dashboard-blueprint-preflight.js';

export type PanelStatus = {
    tone: 'success' | 'error' | 'neutral';
    message: string;
};

export type DashboardBlueprintPreflightView = DashboardBlueprintPreflightReport & {
    checkedAt?: string;
    expiresAt?: string;
};

export type PlanStepPageState = {
    steps: DashboardBlueprintPlanStep[];
    nextCursor?: string;
};

export type BackupPageState = {
    backups: DashboardBlueprintBackupSummary[];
    nextCursor?: string;
};

export type DriftState = Extract<DashboardBlueprintDriftResult, { type: 'structure-drift' }>;

export const emptyExplorerComparisonTarget: DashboardBlueprintExplorerComparisonTarget = {
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
