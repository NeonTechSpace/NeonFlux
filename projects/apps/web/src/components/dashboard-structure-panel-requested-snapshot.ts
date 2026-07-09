import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';
import type { DashboardStructureExplorerSource } from './dashboard-structure-explorer.js';
import { parseDashboardStructureExplorerSnapshot } from './dashboard-structure-explorer-model.js';

export function readRequestedFinalStateExplorerSnapshot(
    run: DashboardStructureImportRun
): DashboardStructureExplorerSource['snapshot'] {
    return run.requestedSnapshot
        ? parseDashboardStructureExplorerSnapshot(JSON.stringify(run.requestedSnapshot))
        : undefined;
}
