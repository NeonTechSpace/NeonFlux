import { lazy, Suspense } from 'react';

import type { DashboardBlueprintBackupSettings, DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import { DashboardBlueprintDriftPanel as DriftPanel } from './dashboard-blueprint-drift-panel.js';
import type { DashboardBlueprintExplorerPanelState } from './dashboard-blueprint-panel-explorer-state.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';
import { DashboardBlueprintLoading } from './dashboard-blueprint-panel-shared.js';
import type { DashboardBlueprintPreflightView, DriftState } from './dashboard-blueprint-panel-types.js';
import { dashboardBlueprintSurfaceIdentity as surfaceIdentity } from './dashboard-blueprint-surface.js';

const DashboardBlueprintExplorer = lazy(() =>
    import('./dashboard-blueprint-explorer.js').then((module) => ({ default: module.DashboardBlueprintExplorer }))
);

export type DashboardBlueprintCompareWorkspace = {
    backupSettings: DashboardBlueprintBackupSettings;
    busyAction: BlueprintBusyAction | undefined;
    driftState: DriftState | undefined;
    explorer: DashboardBlueprintExplorerPanelState;
    plans: DashboardBlueprintPlan[];
    preflightByPlanId: Record<string, DashboardBlueprintPreflightView>;
    onCheckLatestDrift: () => void;
    onCreateBackup: () => void;
    onCreateRestorePlan: (backupId: string) => void;
    onLoadPlanSteps: (run: DashboardBlueprintPlan) => void;
    onReviewScheduledDrift: (baselineBackupId: string) => void;
};

export function DashboardBlueprintCompareSurface({ workspace }: { workspace: DashboardBlueprintCompareWorkspace }) {
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
                onCreateDryRun={(backup) => workspace.onCreateRestorePlan(backup.id)}
                onReviewScheduledDrift={workspace.onReviewScheduledDrift}
                onSelectAction={workspace.explorer.selectDriftAction}
            />
            <div className='mt-5'>
                <Suspense fallback={<DashboardBlueprintLoading />}>
                    <DashboardBlueprintExplorer
                        busyAction={workspace.busyAction}
                        drift={workspace.driftState}
                        overlayMode={workspace.explorer.explorerOverlayMode}
                        preflightByPlanId={workspace.preflightByPlanId}
                        plans={workspace.plans}
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
                        onLoadPlanSteps={workspace.onLoadPlanSteps}
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
