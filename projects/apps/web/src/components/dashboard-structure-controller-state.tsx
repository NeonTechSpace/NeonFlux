import type { DashboardStructurePanelViewProps } from './dashboard-structure-panel-view.js';
import type { DashboardStructureProgressTransport } from './dashboard-structure-execution-progress.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';

export type DashboardStructureControllerShellState = {
    activeRun?: Pick<DashboardStructureImportRun, 'id' | 'execution'>;
    executionProgressIssue?: { code: string; runId: string };
    executionTransport: DashboardStructureProgressTransport;
};

export type DashboardStructureControllerState =
    | { type: 'loading'; shell: DashboardStructureControllerShellState }
    | { type: 'error'; diagnosticCode: string; retry: () => void; shell: DashboardStructureControllerShellState }
    | { type: 'ready'; workspace: DashboardStructurePanelViewProps; shell: DashboardStructureControllerShellState };
