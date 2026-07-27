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

export type BlueprintBusyAction =
    | 'export'
    | 'backup'
    | 'backup-settings'
    | 'drift'
    | 'explorer-live'
    | 'explorer-compare-live'
    | 'explorer-compare-baseline'
    | `backup-json:${string}`
    | 'backup-page'
    | `backup-drift:${string}`
    | `backup-rename:${string}`
    | `backup-delete:${string}`
    | `backup-import:${string}`
    | 'plan'
    | `plan-authority:${string}`
    | `plan-evidence:${string}`
    | `plan-steps:${string}`
    | `decisions:${string}`
    | `approval:${string}`
    | `preflight:${string}`
    | `apply:${string}`
    | `control:${string}`
    | `recovery:${string}`;

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
