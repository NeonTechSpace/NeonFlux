import { lazy, Suspense } from 'react';

import type {
    DashboardStructureBackupSettings,
    DashboardStructureImportRun,
} from '../server/dashboard-structure-model.js';
import { DashboardStructureDriftPanel as DriftPanel } from './dashboard-structure-drift-panel.js';
import type { DashboardStructureExplorerPanelState } from './dashboard-structure-panel-explorer-state.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { DashboardStructureLoading } from './dashboard-structure-panel-shared.js';
import type { DashboardStructurePreflightView, DriftState } from './dashboard-structure-panel-types.js';
import { dashboardStructureSurfaceIdentity as surfaceIdentity } from './dashboard-structure-surface.js';

const DashboardStructureExplorer = lazy(() =>
    import('./dashboard-structure-explorer.js').then((module) => ({ default: module.DashboardStructureExplorer }))
);

export type DashboardStructureCompareWorkspace = {
    backupSettings: DashboardStructureBackupSettings;
    busyAction: StructureBusyAction | undefined;
    driftState: DriftState | undefined;
    explorer: DashboardStructureExplorerPanelState;
    importRuns: DashboardStructureImportRun[];
    preflightByRunId: Record<string, DashboardStructurePreflightView>;
    onCheckLatestDrift: () => void;
    onCreateBackup: () => void;
    onCreateRestoreDryRun: (backupId: string) => void;
    onLoadRunActions: (run: DashboardStructureImportRun) => void;
    onReviewScheduledDrift: (baselineBackupId: string) => void;
};

export function DashboardStructureCompareSurface({ workspace }: { workspace: DashboardStructureCompareWorkspace }) {
    return (
        <section aria-labelledby='blueprint-compare-heading' className='@container/blueprint min-w-0'>
            <div className='mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--dash-border)] pb-4'>
                <div>
                    <h2 id='blueprint-compare-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                        {surfaceIdentity.compare.heading}
                    </h2>
                    <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>{surfaceIdentity.compare.description}</p>
                </div>
            </div>
            <DriftPanel
                drift={workspace.driftState}
                settings={workspace.backupSettings}
                busyAction={workspace.busyAction}
                onCheckLatest={workspace.onCheckLatestDrift}
                onCreateBackup={workspace.onCreateBackup}
                onCreateDryRun={(backup) => workspace.onCreateRestoreDryRun(backup.id)}
                onReviewScheduledDrift={workspace.onReviewScheduledDrift}
                onSelectAction={workspace.explorer.selectDriftAction}
            />
            <div className='mt-5'>
                <Suspense fallback={<DashboardStructureLoading />}>
                    <DashboardStructureExplorer
                        busyAction={workspace.busyAction}
                        drift={workspace.driftState}
                        overlayMode={workspace.explorer.explorerOverlayMode}
                        preflightByRunId={workspace.preflightByRunId}
                        runs={workspace.importRuns}
                        section={workspace.explorer.explorerSection}
                        selectedEntityKey={workspace.explorer.selectedExplorerEntityKey}
                        comparisonTarget={workspace.explorer.explorerComparisonTarget}
                        source={workspace.explorer.explorerSource}
                        onCompareDriftBaseline={() => void workspace.explorer.compareExplorerDriftBaseline()}
                        onCompareImportJson={workspace.explorer.compareExplorerImportJson}
                        onCompareLive={() => void workspace.explorer.compareExplorerLive()}
                        onCompareRequestedFinalState={workspace.explorer.compareExplorerRequestedFinalState}
                        onInspectImportJson={workspace.explorer.inspectImportJson}
                        onInspectRequestedFinalState={workspace.explorer.inspectRequestedFinalState}
                        onLoadActions={workspace.onLoadRunActions}
                        onLoadLive={() => void workspace.explorer.loadLiveExplorerSnapshot()}
                        onOverlayModeChange={workspace.explorer.setExplorerOverlayMode}
                        onSectionChange={workspace.explorer.setExplorerSection}
                        onSelectedEntityKeyChange={workspace.explorer.setSelectedExplorerEntityKey}
                    />
                </Suspense>
            </div>
        </section>
    );
}
