import type { Dispatch, SetStateAction } from 'react';

import type {
    DashboardStructureBackupSettings,
    DashboardStructureBackupSummary,
    DashboardStructureImportRun,
} from '../server/dashboard-structure.server.js';
import type { DashboardStructurePreflightReport } from '../server/dashboard-structure-preflight.js';
import { DashboardStructureBackupHistory as BackupHistory } from './dashboard-structure-backup-history.js';
import { DashboardStructureBackupSettings as BackupSettings } from './dashboard-structure-backup-settings.js';
import { DashboardStructureBackupStatus as BackupStatus } from './dashboard-structure-backup-status.js';
import { DashboardStructureDriftPanel as DriftPanel } from './dashboard-structure-drift-panel.js';
import { DashboardStructureExplorer } from './dashboard-structure-explorer.js';
import { DashboardStructureImportHistory } from './dashboard-structure-import-history.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import type { DashboardStructureExplorerPanelState } from './dashboard-structure-panel-explorer-state.js';
import { formatObservedState } from './dashboard-structure-panel-format.js';
import { RestorePointShortcutNotice, StatusMessage } from './dashboard-structure-panel-shared.js';
import type { BackupPageState, DriftState, PanelStatus } from './dashboard-structure-panel-types.js';

export function DashboardStructurePanelView({
    applyConfirmationByRunId,
    backupJson,
    backupPage,
    backupSettings,
    busyAction,
    cadenceDraft,
    confirmationByRunId,
    deleteConfirmBackupId,
    deleteConfirmationByRunId,
    editingBackupId,
    editingBackupName,
    enabledDraft,
    explorer,
    importJson,
    importRuns,
    latestRun,
    observedState,
    preflightByRunId,
    restoreShortcutBackupId,
    retentionDraft,
    status,
    onApplyConfirmationChange,
    onApplyRun,
    onBackupCadenceWeeksChange,
    onBackupDelete,
    onBackupDownload,
    onBackupImport,
    onBackupInspect,
    onBackupRename,
    onBackupRenameNameChange,
    onBeginBackupRename,
    onCancelBackupDelete,
    onCancelBackupRename,
    onCheckBackupDrift,
    onCheckLatestDrift,
    onConfirmRun,
    onCreateBackup,
    onCreateDryRun,
    onCreateRestoreDryRun,
    onDeleteConfirmationChange,
    onDriftCreateDryRun,
    onImportJsonChange,
    onImportStructureFile,
    onLoadMoreBackups,
    onLoadRunActions,
    onPreflightRun,
    onConfirmationChange,
    onRetryRun,
    onSaveBackupSettings,
    onSetBackupJsonAsImportJson,
    onBackupEnabledChange,
    onBackupRetentionDaysChange,
    onDownloadCurrentStructure,
    onReviewScheduledDrift,
    driftState,
}: DashboardStructurePanelViewProps) {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900'>
            <div className='border-b border-neutral-800 px-4 py-3'>
                <h3 className='text-lg font-semibold text-white'>Import / Export</h3>
                <p className='mt-1 text-sm leading-6 text-neutral-400'>
                    Back up server layout, dry-run imports, preflight confirmed runs, and apply supported role, channel,
                    category, and permission changes.
                </p>
                {observedState.observedChangeCount > 0 ? (
                    <p className='mt-2 text-sm leading-6 text-sky-200'>{formatObservedState(observedState)}</p>
                ) : null}
            </div>

            <div className='grid gap-0 divide-y divide-neutral-800 xl:grid-cols-[minmax(22rem,32rem)_minmax(0,1fr)] xl:divide-x xl:divide-y-0'>
                <section className='space-y-4 p-4' aria-labelledby='structure-tools-heading'>
                    <h4 id='structure-tools-heading' className='text-sm font-semibold text-white'>
                        Server blueprint tools
                    </h4>
                    <BackupSettings
                        settings={backupSettings}
                        enabled={enabledDraft}
                        cadenceWeeks={cadenceDraft}
                        retentionDays={retentionDraft}
                        busy={busyAction === 'backup-settings'}
                        onEnabledChange={onBackupEnabledChange}
                        onCadenceWeeksChange={onBackupCadenceWeeksChange}
                        onRetentionDaysChange={onBackupRetentionDaysChange}
                        onSave={onSaveBackupSettings}
                    />
                    <div className='rounded-md border border-neutral-800 bg-neutral-950/60 p-3'>
                        <div className='flex flex-wrap items-center justify-between gap-3'>
                            <div>
                                <p className='text-sm font-semibold text-white'>Create manual backup</p>
                                <p className='mt-1 text-xs leading-5 text-neutral-400'>
                                    Reads roles, categories, channels, and permission overwrites.
                                </p>
                            </div>
                            <button
                                type='button'
                                onClick={onCreateBackup}
                                disabled={Boolean(busyAction)}
                                className='min-h-10 rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                                {busyAction === 'backup' ? 'Creating' : 'Create backup'}
                            </button>
                        </div>
                        {backupJson ? (
                            <div className='mt-3 space-y-2'>
                                <div className='flex flex-wrap items-center justify-between gap-2'>
                                    <p className='text-xs font-medium text-neutral-300'>Latest backup JSON</p>
                                    <button
                                        type='button'
                                        onClick={onSetBackupJsonAsImportJson}
                                        className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-200 transition hover:border-sky-400 hover:text-sky-200'>
                                        Use for dry-run
                                    </button>
                                </div>
                                <textarea
                                    value={backupJson}
                                    readOnly
                                    rows={8}
                                    className='w-full resize-y rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-300 outline-none'
                                />
                            </div>
                        ) : null}
                    </div>

                    <div className='rounded-md border border-neutral-800 bg-neutral-950/60 p-3'>
                        <div className='flex flex-wrap items-center justify-between gap-3'>
                            <div>
                                <p className='text-sm font-semibold text-white'>Download current blueprint</p>
                                <p className='mt-1 text-xs leading-5 text-neutral-400'>
                                    Exports import-ready JSON without creating a backup record.
                                </p>
                            </div>
                            <button
                                type='button'
                                onClick={onDownloadCurrentStructure}
                                disabled={Boolean(busyAction)}
                                className='min-h-10 rounded-md border border-neutral-700 px-4 text-sm font-semibold text-neutral-200 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-500'>
                                {busyAction === 'export' ? 'Downloading' : 'Download JSON'}
                            </button>
                        </div>
                    </div>

                    <div className='block space-y-2 text-sm font-medium text-neutral-200'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                            <label htmlFor='server-blueprint-import-json'>Import JSON dry-run</label>
                            <button
                                type='button'
                                onClick={explorer.inspectImportJson}
                                disabled={Boolean(busyAction)}
                                className='min-h-8 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-neutral-500'>
                                Inspect import JSON
                            </button>
                        </div>
                        <textarea
                            id='server-blueprint-import-json'
                            value={importJson}
                            onChange={(event) => onImportJsonChange(event.currentTarget.value)}
                            rows={12}
                            spellCheck={false}
                            className='w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                            placeholder='Paste server blueprint JSON from a backup or current-state download.'
                        />
                    </div>
                    <label className='block space-y-2 text-sm font-medium text-neutral-200'>
                        <span>Import JSON file</span>
                        <input
                            type='file'
                            accept='application/json,.json'
                            onChange={(event) => {
                                void onImportStructureFile(event.currentTarget.files?.[0]);
                                event.currentTarget.value = '';
                            }}
                            className='block w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-neutral-100 hover:file:bg-neutral-700'
                        />
                    </label>
                    <button
                        type='button'
                        onClick={onCreateDryRun}
                        disabled={Boolean(busyAction)}
                        className='min-h-10 w-full rounded-md bg-sky-400 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        {busyAction === 'dry-run' ? 'Creating dry-run' : 'Create dry-run'}
                    </button>
                    {status ? <StatusMessage status={status} /> : null}
                    {restoreShortcutBackupId ? (
                        <RestorePointShortcutNotice
                            backupId={restoreShortcutBackupId}
                            busy={busyAction === `backup-import:${restoreShortcutBackupId}`}
                            disabled={Boolean(busyAction)}
                            onCreateRestoreDryRun={onCreateRestoreDryRun}
                        />
                    ) : null}
                    <p className='text-xs leading-5 text-neutral-500'>
                        Applies supported creates, deletes, role name/color/hoist/mentionability/permission/position
                        updates, channel/category name, position, parent, and permission-overwrite updates. Topic, NSFW,
                        slowmode, type changes, and moving @everyone are blocked.
                    </p>
                </section>

                <section className='space-y-5 p-4' aria-labelledby='structure-history-heading'>
                    <div>
                        <h4 id='structure-history-heading' className='text-sm font-semibold text-white'>
                            Recent blueprint history
                        </h4>
                        <p className='mt-1 text-xs leading-5 text-neutral-400'>
                            Backups and dry-runs are scoped to this server.
                        </p>
                    </div>
                    <BackupStatus
                        backups={backupPage.backups}
                        observedState={observedState}
                        settings={backupSettings}
                    />
                    <DriftPanel
                        drift={driftState}
                        settings={backupSettings}
                        busyAction={busyAction}
                        onCheckLatest={onCheckLatestDrift}
                        onCreateBackup={onCreateBackup}
                        onCreateDryRun={onDriftCreateDryRun}
                        onReviewScheduledDrift={onReviewScheduledDrift}
                        onSelectAction={explorer.selectDriftAction}
                    />
                    <DashboardStructureExplorer
                        busyAction={busyAction}
                        drift={driftState}
                        overlayMode={explorer.explorerOverlayMode}
                        preflightByRunId={preflightByRunId}
                        runs={importRuns}
                        selectedEntityKey={explorer.selectedExplorerEntityKey}
                        comparisonTarget={explorer.explorerComparisonTarget}
                        source={explorer.explorerSource}
                        onCompareDriftBaseline={() => void explorer.compareExplorerDriftBaseline()}
                        onCompareImportJson={explorer.compareExplorerImportJson}
                        onCompareLive={() => void explorer.compareExplorerLive()}
                        onCompareRequestedFinalState={explorer.compareExplorerRequestedFinalState}
                        onInspectImportJson={explorer.inspectImportJson}
                        onInspectRequestedFinalState={explorer.inspectRequestedFinalState}
                        onLoadActions={onLoadRunActions}
                        onLoadLive={() => void explorer.loadLiveExplorerSnapshot()}
                        onOverlayModeChange={explorer.setExplorerOverlayMode}
                        onSelectedEntityKeyChange={explorer.setSelectedExplorerEntityKey}
                    />
                    <BackupHistory
                        page={backupPage}
                        busyAction={busyAction}
                        onDownload={onBackupDownload}
                        onCheckDrift={onCheckBackupDrift}
                        onInspect={onBackupInspect}
                        onImport={onBackupImport}
                        onLoadMore={onLoadMoreBackups}
                        onRename={onBackupRename}
                        onDelete={onBackupDelete}
                        editingBackupId={editingBackupId}
                        editingBackupName={editingBackupName}
                        deleteConfirmBackupId={deleteConfirmBackupId}
                        onBeginRename={onBeginBackupRename}
                        onCancelRename={onCancelBackupRename}
                        onRenameNameChange={onBackupRenameNameChange}
                        onCancelDelete={onCancelBackupDelete}
                    />
                    <DashboardStructureImportHistory
                        runs={importRuns}
                        latestRun={latestRun}
                        busyAction={busyAction}
                        confirmationByRunId={confirmationByRunId}
                        preflightByRunId={preflightByRunId}
                        applyConfirmationByRunId={applyConfirmationByRunId}
                        deleteConfirmationByRunId={deleteConfirmationByRunId}
                        onConfirmationChange={onConfirmationChange}
                        onApplyConfirmationChange={onApplyConfirmationChange}
                        onDeleteConfirmationChange={onDeleteConfirmationChange}
                        onConfirm={onConfirmRun}
                        onPreflight={onPreflightRun}
                        onApply={onApplyRun}
                        onLoadActions={onLoadRunActions}
                        onInspectAction={explorer.selectImportAction}
                        onRetry={onRetryRun}
                    />
                </section>
            </div>
        </article>
    );
}

type DashboardStructurePanelViewProps = {
    applyConfirmationByRunId: Record<string, string>;
    backupJson: string;
    backupPage: BackupPageState;
    backupSettings: DashboardStructureBackupSettings;
    busyAction: StructureBusyAction | undefined;
    cadenceDraft: number;
    confirmationByRunId: Record<string, string>;
    deleteConfirmBackupId: string | undefined;
    deleteConfirmationByRunId: Record<string, string>;
    driftState: DriftState | undefined;
    editingBackupId: string | undefined;
    editingBackupName: string;
    enabledDraft: boolean;
    explorer: DashboardStructureExplorerPanelState;
    importJson: string;
    importRuns: DashboardStructureImportRun[];
    latestRun: DashboardStructureImportRun | undefined;
    observedState: {
        observedChangeCount: number;
        lastEventType?: string;
        lastObservedAt?: string;
        changedSinceLastBackup: boolean;
    };
    preflightByRunId: Record<string, DashboardStructurePreflightReport>;
    restoreShortcutBackupId: string | undefined;
    retentionDraft: number;
    status: PanelStatus | undefined;
    onApplyConfirmationChange: (runId: string, confirmation: string) => void;
    onApplyRun: (run: DashboardStructureImportRun) => void;
    onBackupCadenceWeeksChange: Dispatch<SetStateAction<number | undefined>>;
    onBackupDelete: (backup: DashboardStructureBackupSummary) => void;
    onBackupDownload: (backup: DashboardStructureBackupSummary) => void;
    onBackupEnabledChange: Dispatch<SetStateAction<boolean | undefined>>;
    onBackupImport: (backup: DashboardStructureBackupSummary) => void;
    onBackupInspect: (backup: DashboardStructureBackupSummary) => void;
    onBackupRename: (backup: DashboardStructureBackupSummary) => void;
    onBackupRenameNameChange: Dispatch<SetStateAction<string>>;
    onBackupRetentionDaysChange: Dispatch<SetStateAction<number | undefined>>;
    onBeginBackupRename: (backup: DashboardStructureBackupSummary) => void;
    onCancelBackupDelete: () => void;
    onCancelBackupRename: () => void;
    onCheckBackupDrift: (backup: DashboardStructureBackupSummary) => void;
    onCheckLatestDrift: () => void;
    onConfirmRun: (run: DashboardStructureImportRun) => void;
    onCreateBackup: () => void;
    onCreateDryRun: () => void;
    onCreateRestoreDryRun: (backupId: string) => void;
    onDeleteConfirmationChange: (runId: string, confirmation: string) => void;
    onDownloadCurrentStructure: () => void;
    onDriftCreateDryRun: (backup: DashboardStructureBackupSummary) => void;
    onImportJsonChange: Dispatch<SetStateAction<string>>;
    onImportStructureFile: (file: File | undefined) => Promise<void>;
    onLoadMoreBackups: () => void;
    onLoadRunActions: (run: DashboardStructureImportRun) => void;
    onPreflightRun: (run: DashboardStructureImportRun) => void;
    onConfirmationChange: (runId: string, confirmation: string) => void;
    onRetryRun: (run: DashboardStructureImportRun) => void;
    onSaveBackupSettings: () => void;
    onSetBackupJsonAsImportJson: () => void;
    onReviewScheduledDrift: (baselineBackupId: string) => void;
};
