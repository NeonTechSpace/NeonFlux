import type { DashboardBlueprintExplorerSnapshot } from './dashboard-blueprint-explorer-snapshot.js';

export type DashboardBlueprintExplorerSource = {
    canonicalJson?: string;
    detail?: string;
    label: string;
    snapshot?: DashboardBlueprintExplorerSnapshot;
    type: 'backup' | 'import-json' | 'live' | 'none' | 'requested-final-state';
};

export type DashboardBlueprintExplorerComparisonTarget = DashboardBlueprintExplorerSource;

export type DashboardBlueprintExplorerOverlayMode = 'drift' | 'none' | `plan:${string}`;
