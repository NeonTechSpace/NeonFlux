import type { DashboardStructureExplorerSnapshot } from './dashboard-structure-explorer-snapshot.js';

export type DashboardStructureExplorerSource = {
    canonicalJson?: string;
    detail?: string;
    label: string;
    snapshot?: DashboardStructureExplorerSnapshot;
    type: 'backup' | 'import-json' | 'live' | 'none' | 'requested-final-state';
};

export type DashboardStructureExplorerComparisonTarget = DashboardStructureExplorerSource;

export type DashboardStructureExplorerOverlayMode = 'drift' | 'none' | `run:${string}`;
