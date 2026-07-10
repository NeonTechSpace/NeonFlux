import { motion } from 'motion/react';
import type { Dispatch, SetStateAction } from 'react';

import type {
    DashboardStructureBackupSettings,
    DashboardStructureBackupSummary,
    DashboardStructureImportRun,
    DashboardStructureRoleMappingConflict,
} from '../server/dashboard-structure.server.js';
import type { DashboardStructurePreflightReport } from '../server/dashboard-structure-preflight.js';
import type { DashboardStructurePolicy } from '../server/dashboard-structure-v2.js';
import { DashboardStructureBackupHistory as BackupHistory } from './dashboard-structure-backup-history.js';
import { DashboardStructureBackupSettings as BackupSettings } from './dashboard-structure-backup-settings.js';
import type { DashboardStructureBackupSettingsValue } from './dashboard-structure-backup-settings.js';
import { DashboardStructureBackupStatus as BackupStatus } from './dashboard-structure-backup-status.js';
import { DashboardStructureDriftPanel as DriftPanel } from './dashboard-structure-drift-panel.js';
import { DashboardStructureExplorer } from './dashboard-structure-explorer.js';
import { DashboardStructureImportHistory } from './dashboard-structure-import-history.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import type { DashboardStructureExplorerPanelState } from './dashboard-structure-panel-explorer-state.js';
import { formatDate, formatObservedState } from './dashboard-structure-panel-format.js';
import { RestorePointShortcutNotice, StatusMessage } from './dashboard-structure-panel-shared.js';
import type { BackupPageState, DriftState, PanelStatus } from './dashboard-structure-panel-types.js';

export type DashboardStructureSurface = 'current' | 'backups' | 'compare' | 'deploy' | 'runs';

export const dashboardStructureDeploymentPolicies = [
    {
        value: 'merge',
        label: 'Merge additions only',
        description: 'Create missing items and update or reorder matches while retaining eligible target-only items.',
    },
    {
        value: 'synchronize',
        label: 'Match blueprint (recommended)',
        description: 'Match eligible roles and channels, including deleting eligible target-only objects.',
    },
    {
        value: 'rebuild',
        label: 'Reset and rebuild',
        description: 'Delete all eligible roles and channels, retain protected objects, then recreate the blueprint.',
    },
] as const satisfies ReadonlyArray<{
    value: DashboardStructurePolicy;
    label: string;
    description: string;
}>;

export function DashboardStructurePanelView({
    surface,
    ...workspace
}: DashboardStructurePanelViewProps & { surface: DashboardStructureSurface | 'all' }) {
    const refreshIssue = workspace.settingsRefreshIssue ? (
        <ExecutionProgressIssue
            code={workspace.settingsRefreshIssue.code}
            message='Blueprint data could not refresh. The last confirmed workspace remains visible.'
            retryLabel='Retry Blueprint refresh'
            onRetry={workspace.onRetrySettingsRefresh}
        />
    ) : null;
    if (surface === 'all') {
        return (
            <div className='space-y-12'>
                {refreshIssue}
                <CurrentSurface workspace={workspace} showActions={false} />
                <BackupsSurface workspace={workspace} showStatus={false} />
                <CompareSurface workspace={workspace} />
                <DeploySurface workspace={workspace} forceSourceDetails />
                <RunsSurface workspace={workspace} includeDetails={false} />
            </div>
        );
    }

    return (
        <motion.div
            key={surface}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}>
            {refreshIssue}
            {surface === 'current' ? <CurrentSurface workspace={workspace} showActions /> : null}
            {surface === 'backups' ? <BackupsSurface workspace={workspace} showStatus /> : null}
            {surface === 'compare' ? <CompareSurface workspace={workspace} /> : null}
            {surface === 'deploy' ? <DeploySurface workspace={workspace} forceSourceDetails={false} /> : null}
            {surface === 'runs' ? <RunsSurface workspace={workspace} includeDetails /> : null}
        </motion.div>
    );
}

function CurrentSurface({
    workspace,
    showActions,
}: {
    workspace: DashboardStructurePanelViewProps;
    showActions: boolean;
}) {
    const latestBackup = workspace.backupPage.backups.find((backup) => backup.status === 'succeeded');
    const observedCopy =
        workspace.observedState.observedChangeCount > 0
            ? formatObservedState(workspace.observedState)
            : 'No layout events observed since this process started.';
    const drift = workspace.driftState;
    const driftChangeCount = drift ? drift.summary.creates + drift.summary.updates + drift.summary.deletes : undefined;
    const driftCopy = drift
        ? `${driftChangeCount} ${driftChangeCount === 1 ? 'difference' : 'differences'} checked ${formatDate(drift.checkedAt)}`
        : workspace.backupSettings.scheduledDrift?.checkedAt
          ? `Last comparison ${formatDate(workspace.backupSettings.scheduledDrift.checkedAt)}`
          : 'No comparison has been run';

    return (
        <section aria-labelledby='blueprint-current-heading' className='mx-auto max-w-[74rem]'>
            <div className='flex flex-wrap items-end justify-between gap-5 border-b border-[var(--dash-border)] pb-5'>
                <div>
                    <h3 id='blueprint-current-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                        Current layout
                    </h3>
                    <p className='mt-1 max-w-2xl text-sm leading-6 text-[var(--dash-text-muted)]'>
                        The relationship between the latest protected version and what is live now.
                    </p>
                </div>
                {showActions ? (
                    <div className='flex flex-wrap gap-2'>
                        <button
                            type='button'
                            onClick={workspace.onDownloadCurrentStructure}
                            disabled={Boolean(workspace.busyAction)}
                            className={secondaryButtonClass}>
                            {workspace.busyAction === 'export' ? 'Preparing JSON' : 'Download current JSON'}
                        </button>
                        <button
                            type='button'
                            onClick={latestBackup ? workspace.onCheckLatestDrift : workspace.onCreateBackup}
                            disabled={Boolean(workspace.busyAction)}
                            className={primaryButtonClass}>
                            {latestBackup ? 'Check differences' : 'Create first backup'}
                        </button>
                    </div>
                ) : null}
            </div>

            <div className='grid border-b border-[var(--dash-border)] lg:grid-cols-[1fr_auto_1fr_auto_1fr]'>
                <VersionPoint
                    label='Protected version'
                    title={latestBackup?.name ?? 'No baseline yet'}
                    detail={latestBackup ? formatDate(latestBackup.completedAt) : 'Create a backup to establish one'}
                />
                <VersionConnector />
                <VersionPoint label='Observed activity' title={observedCopy} detail={driftCopy} />
                <VersionConnector />
                <VersionPoint
                    label='Live layout'
                    title={
                        workspace.observedState.changedSinceLastBackup ? 'May differ from baseline' : 'Ready to inspect'
                    }
                    detail={
                        latestBackup
                            ? `${latestBackup.roleCount} roles · ${latestBackup.categoryCount} categories · ${latestBackup.channelCount} channels in baseline`
                            : 'Live inventory has not been captured yet'
                    }
                />
            </div>

            {!latestBackup ? (
                <p className='border-b border-[var(--dash-border)] py-5 text-sm leading-6 text-[var(--dash-text-muted)]'>
                    No baseline yet. Create a backup to compare future layout changes and provide a recovery source.
                </p>
            ) : null}
            <div className='py-6'>
                <BackupStatus
                    backups={workspace.backupPage.backups}
                    observedState={workspace.observedState}
                    settings={workspace.backupSettings}
                />
            </div>
            {showActions && workspace.status ? <StatusMessage status={workspace.status} /> : null}
        </section>
    );
}

function VersionPoint({ label, title, detail }: { label: string; title: string; detail: string }) {
    return (
        <div className='min-w-0 py-5 lg:px-4 lg:first:pl-0 lg:last:pr-0'>
            <p className='text-xs font-medium text-[var(--dash-text-subtle)]'>{label}</p>
            <p className='mt-2 text-sm font-semibold text-[var(--dash-text)]'>{title}</p>
            <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>{detail}</p>
        </div>
    );
}

function VersionConnector() {
    return <div className='hidden w-px self-stretch bg-[var(--dash-border)] lg:block' aria-hidden='true' />;
}

function BackupsSurface({
    workspace,
    showStatus,
}: {
    workspace: DashboardStructurePanelViewProps;
    showStatus: boolean;
}) {
    const scheduleCopy = workspace.backupSettings.enabled
        ? `Automatic backup every ${workspace.backupSettings.cadenceWeeks === 1 ? 'week' : `${workspace.backupSettings.cadenceWeeks} weeks`} · keep ${workspace.backupSettings.retentionDays} days${workspace.backupSettings.nextBackupAt ? ` · next ${formatDate(workspace.backupSettings.nextBackupAt)}` : ''}`
        : 'Automatic backups are off.';

    return (
        <section aria-labelledby='blueprint-backups-heading' className='mx-auto max-w-[78rem]'>
            <div className='flex flex-wrap items-end justify-between gap-4 border-b border-[var(--dash-border)] pb-4'>
                <div>
                    <h3 id='blueprint-backups-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                        Protected versions
                    </h3>
                    <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>{scheduleCopy}</p>
                </div>
                <div className='flex flex-wrap gap-2'>
                    <button
                        type='button'
                        onClick={workspace.onDownloadCurrentStructure}
                        disabled={Boolean(workspace.busyAction)}
                        className={secondaryButtonClass}>
                        {workspace.busyAction === 'export' ? 'Preparing JSON' : 'Download JSON'}
                    </button>
                    <button
                        type='button'
                        onClick={workspace.onCreateBackup}
                        disabled={Boolean(workspace.busyAction)}
                        className={primaryButtonClass}>
                        {workspace.busyAction === 'backup' ? 'Creating backup' : 'Create backup'}
                    </button>
                </div>
            </div>

            <details className='group border-b border-[var(--dash-border)]'>
                <summary className='flex min-h-12 cursor-pointer list-none items-center justify-between text-sm font-medium text-[var(--dash-text)] marker:hidden'>
                    Schedule and retention
                    <span className='text-xs text-[var(--dash-text-muted)] group-open:hidden'>Edit</span>
                    <span className='hidden text-xs text-[var(--dash-text-muted)] group-open:inline'>Close</span>
                </summary>
                <div className='max-w-2xl pb-5'>
                    <BackupSettings
                        settings={workspace.backupSettings}
                        enabled={workspace.enabledDraft}
                        cadenceWeeks={workspace.cadenceDraft}
                        retentionDays={workspace.retentionDraft}
                        busy={workspace.busyAction === 'backup-settings'}
                        onEnabledChange={workspace.onBackupEnabledChange}
                        onCadenceWeeksChange={workspace.onBackupCadenceWeeksChange}
                        onRetentionDaysChange={workspace.onBackupRetentionDaysChange}
                        onSave={workspace.onSaveBackupSettings}
                    />
                </div>
            </details>

            {workspace.backupJson ? (
                <div className='flex flex-wrap items-center justify-between gap-3 border-b border-[var(--dash-border)] py-4'>
                    <p className='text-sm text-[var(--dash-text-muted)]'>The new backup is available for deployment.</p>
                    <button
                        type='button'
                        onClick={workspace.onSetBackupJsonAsImportJson}
                        className={secondaryButtonClass}>
                        Use as deploy source
                    </button>
                </div>
            ) : null}
            {showStatus && workspace.status ? (
                <div className='py-4'>
                    <StatusMessage status={workspace.status} />
                </div>
            ) : null}
            <div className='pt-5'>
                <BackupHistory
                    page={workspace.backupPage}
                    busyAction={workspace.busyAction}
                    onDownload={workspace.onBackupDownload}
                    onCheckDrift={workspace.onCheckBackupDrift}
                    onInspect={workspace.onBackupInspect}
                    onImport={workspace.onBackupImport}
                    onLoadMore={workspace.onLoadMoreBackups}
                    onRename={workspace.onBackupRename}
                    onDelete={workspace.onBackupDelete}
                    editingBackupId={workspace.editingBackupId}
                    editingBackupName={workspace.editingBackupName}
                    deleteConfirmBackupId={workspace.deleteConfirmBackupId}
                    onBeginRename={workspace.onBeginBackupRename}
                    onCancelRename={workspace.onCancelBackupRename}
                    onRenameNameChange={workspace.onBackupRenameNameChange}
                    onCancelDelete={workspace.onCancelBackupDelete}
                />
            </div>
        </section>
    );
}

function CompareSurface({ workspace }: { workspace: DashboardStructurePanelViewProps }) {
    return (
        <section aria-labelledby='blueprint-compare-heading' className='@container/blueprint min-w-0'>
            <div className='mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--dash-border)] pb-4'>
                <div>
                    <h3 id='blueprint-compare-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                        Compare layouts
                    </h3>
                    <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>
                        Domain changes first. Raw normalized JSON remains an advanced inspection mode.
                    </p>
                </div>
            </div>
            <DriftPanel
                drift={workspace.driftState}
                settings={workspace.backupSettings}
                busyAction={workspace.busyAction}
                onCheckLatest={workspace.onCheckLatestDrift}
                onCreateBackup={workspace.onCreateBackup}
                onCreateDryRun={workspace.onDriftCreateDryRun}
                onReviewScheduledDrift={workspace.onReviewScheduledDrift}
                onSelectAction={workspace.explorer.selectDriftAction}
            />
            <div className='mt-5'>
                <DashboardStructureExplorer
                    busyAction={workspace.busyAction}
                    drift={workspace.driftState}
                    overlayMode={workspace.explorer.explorerOverlayMode}
                    preflightByRunId={workspace.preflightByRunId}
                    runs={workspace.importRuns}
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
                    onSelectedEntityKeyChange={workspace.explorer.setSelectedExplorerEntityKey}
                />
            </div>
        </section>
    );
}

function DeploySurface({
    workspace,
    forceSourceDetails,
}: {
    workspace: DashboardStructurePanelViewProps;
    forceSourceDetails: boolean;
}) {
    const stage = getDeployStage(workspace.latestRun);

    return (
        <section aria-labelledby='blueprint-deploy-heading' className='mx-auto max-w-[76rem]'>
            <div className='border-b border-[var(--dash-border)] pb-4'>
                <h3 id='blueprint-deploy-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                    Deploy a blueprint
                </h3>
                <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>
                    Prepare one source, review its domain changes, check the live server, then apply deliberately.
                </p>
            </div>
            <ol className='grid border-b border-[var(--dash-border)] md:grid-cols-4' aria-label='Deployment stages'>
                {[
                    'Source',
                    'Review',
                    'Safety check',
                    stage === 4 && workspace.latestRun?.status === 'failed' ? 'Recover' : 'Apply',
                ].map((label, index) => (
                    <li
                        key={label}
                        aria-current={stage === index + 1 ? 'step' : undefined}
                        className={`border-b-2 px-1 py-4 text-sm ${
                            stage === index + 1
                                ? 'border-[var(--dash-primary)] text-[var(--dash-text)]'
                                : index + 1 < stage
                                  ? 'border-transparent text-[var(--dash-text-muted)]'
                                  : 'border-transparent text-[var(--dash-text-subtle)]'
                        }`}>
                        <span className='mr-2 font-mono text-xs'>{index + 1}</span>
                        {label}
                    </li>
                ))}
            </ol>

            {stage === 1 || forceSourceDetails ? (
                <DeploySource workspace={workspace} forceDetailsOpen={forceSourceDetails} />
            ) : null}
            {stage > 1 && workspace.latestRun ? (
                <div className='pt-6'>
                    <DashboardStructureImportHistory
                        runs={[workspace.latestRun]}
                        latestRun={workspace.latestRun}
                        busyAction={workspace.busyAction}
                        preflightByRunId={workspace.preflightByRunId}
                        deleteConfirmationByRunId={workspace.deleteConfirmationByRunId}
                        onDeleteConfirmationChange={workspace.onDeleteConfirmationChange}
                        onApprove={workspace.onApprovePlan}
                        onPreflight={workspace.onPreflightRun}
                        onApply={workspace.onApplyRun}
                        onControl={workspace.onControlExecution}
                        onLoadActions={workspace.onLoadRunActions}
                        onLoadDecisions={workspace.onLoadRunDecisions}
                        onRecoveryPlan={workspace.onRecoveryPlan}
                    />
                </div>
            ) : null}
            {workspace.executionProgressIssue ? (
                <ExecutionProgressIssue
                    code={workspace.executionProgressIssue.code}
                    message='Live progress could not refresh. The last confirmed state remains visible.'
                    retryLabel='Retry progress'
                    onRetry={workspace.onRetryExecutionProgress}
                />
            ) : null}
            {workspace.restoreShortcutBackupId ? (
                <div className='pt-5'>
                    <RestorePointShortcutNotice
                        backupId={workspace.restoreShortcutBackupId}
                        busy={workspace.busyAction === `backup-import:${workspace.restoreShortcutBackupId}`}
                        disabled={Boolean(workspace.busyAction)}
                        onCreateRestoreDryRun={workspace.onCreateRestoreDryRun}
                    />
                </div>
            ) : null}
            {workspace.status ? (
                <div className='pt-5'>
                    <StatusMessage status={workspace.status} />
                </div>
            ) : null}
        </section>
    );
}

function DeploySource({
    workspace,
    forceDetailsOpen,
}: {
    workspace: DashboardStructurePanelViewProps;
    forceDetailsOpen: boolean;
}) {
    const mappingRows = workspace.roleMappingConflicts.flatMap((conflict) =>
        conflict.sourceIds.map((sourceId) => ({ conflict, sourceId }))
    );
    const mappingsComplete =
        mappingRows.length === 0 || mappingRows.every(({ sourceId }) => Boolean(workspace.roleMappings[sourceId]));

    return (
        <div className='pt-6'>
            <label htmlFor='server-blueprint-import-file' className='text-sm font-semibold text-[var(--dash-text)]'>
                Import JSON file
            </label>
            <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                JSON is validated before a deployment plan is created. Nothing changes on Fluxer at this stage.
            </p>
            <input
                id='server-blueprint-import-file'
                type='file'
                accept='application/json,.json'
                onChange={(event) => {
                    void workspace.onImportStructureFile(event.currentTarget.files?.[0]);
                    event.currentTarget.value = '';
                }}
                className='mt-3 block w-full max-w-2xl border-b border-[var(--dash-border)] bg-transparent px-0 py-3 text-sm text-[var(--dash-text-muted)] file:mr-4 file:rounded-[var(--dash-radius-control)] file:border-0 file:bg-[var(--dash-surface-raised)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--dash-text)] hover:file:bg-[var(--dash-surface-selected)]'
            />
            <details
                className='mt-4 max-w-2xl border-y border-[var(--dash-border)]'
                open={forceDetailsOpen || undefined}>
                <summary className='cursor-pointer list-none py-3 text-sm font-medium text-[var(--dash-text)] marker:hidden'>
                    Or paste blueprint JSON
                </summary>
                <div className='pb-4'>
                    <label htmlFor='server-blueprint-import-json' className='sr-only'>
                        Blueprint JSON
                    </label>
                    <textarea
                        id='server-blueprint-import-json'
                        value={workspace.importJson}
                        onChange={(event) => workspace.onImportJsonChange(event.currentTarget.value)}
                        rows={12}
                        spellCheck={false}
                        className='w-full resize-y rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] px-3 py-2 font-mono text-xs text-[var(--dash-text)] outline-none focus:border-[var(--dash-primary)] focus:ring-2 focus:ring-[var(--dash-primary-ring)]'
                        placeholder='Paste normalized Server Blueprint JSON.'
                    />
                    <button
                        type='button'
                        onClick={workspace.explorer.inspectImportJson}
                        disabled={!workspace.importJson.trim() || Boolean(workspace.busyAction)}
                        className={`mt-3 ${secondaryButtonClass}`}>
                        Inspect source
                    </button>
                </div>
            </details>
            {workspace.importJson.trim() ? (
                <fieldset className='mt-5 max-w-2xl' aria-label='Deployment policy'>
                    <legend className='text-sm font-semibold text-[var(--dash-text)]'>Deployment policy</legend>
                    <div className='mt-3 grid gap-2'>
                        {dashboardStructureDeploymentPolicies.map((option) => (
                            <label
                                key={option.value}
                                htmlFor={`structure-policy-${option.value}`}
                                aria-label={option.label}
                                className={`flex cursor-pointer items-start gap-3 rounded-[var(--dash-radius-control)] border p-4 transition ${
                                    workspace.structurePolicy === option.value
                                        ? 'border-[var(--dash-primary)] bg-[var(--dash-primary-ring)]'
                                        : 'border-[var(--dash-border)] bg-[var(--dash-surface-raised)]'
                                }`}>
                                <input
                                    id={`structure-policy-${option.value}`}
                                    type='radio'
                                    name='structure-policy'
                                    value={option.value}
                                    checked={workspace.structurePolicy === option.value}
                                    onChange={() => workspace.onStructurePolicyChange(option.value)}
                                    className='mt-1 size-4 border-[var(--dash-border-strong)] bg-[var(--dash-bg)] text-[var(--dash-primary)]'
                                />
                                <span>
                                    <strong className='block text-sm text-[var(--dash-text)]'>{option.label}</strong>
                                    <span className='mt-1 block text-xs leading-5 text-[var(--dash-text-muted)]'>
                                        {option.description}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
            ) : null}
            {mappingRows.length > 0 ? (
                <div
                    className='mt-5 max-w-2xl rounded-[var(--dash-radius-control)] border border-amber-400/40 bg-amber-950/20 p-4'
                    role='alert'>
                    <h4 className='text-sm font-semibold text-amber-100'>Match duplicate blueprint items</h4>
                    <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                        These roles are still genuinely ambiguous after projecting the final hierarchy. Select each
                        existing target role once. No server changes occur until the reviewed plan is applied.
                    </p>
                    <div className='mt-4 space-y-4'>
                        {mappingRows.map(({ conflict, sourceId }) => (
                            <label key={sourceId} className='block text-xs text-[var(--dash-text-muted)]'>
                                <span className='mb-1 block font-semibold text-[var(--dash-text)]'>
                                    Source {conflict.targetType} {conflict.name} ({sourceId})
                                </span>
                                <select
                                    aria-label={`Target ${conflict.targetType} for ${conflict.name} ${sourceId}`}
                                    value={workspace.roleMappings[sourceId] ?? ''}
                                    onChange={(event) =>
                                        workspace.onRoleMappingChange(sourceId, event.currentTarget.value)
                                    }
                                    className='min-h-10 w-full rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] px-3 text-sm text-[var(--dash-text)] outline-none focus:border-[var(--dash-primary)] focus:ring-2 focus:ring-[var(--dash-primary-ring)]'>
                                    <option value=''>Choose an existing target {conflict.targetType}</option>
                                    {conflict.candidateTargetIds.map((targetId) => {
                                        const selectedByAnotherSource = Object.entries(workspace.roleMappings).some(
                                            ([selectedSourceId, selectedTargetId]) =>
                                                selectedSourceId !== sourceId && selectedTargetId === targetId
                                        );

                                        return (
                                            <option key={targetId} value={targetId} disabled={selectedByAnotherSource}>
                                                {conflict.name} ({targetId})
                                            </option>
                                        );
                                    })}
                                </select>
                            </label>
                        ))}
                    </div>
                </div>
            ) : null}
            <div className='mt-6 flex items-center justify-between gap-4 border-t border-[var(--dash-border)] pt-4'>
                <p className='text-xs text-[var(--dash-text-muted)]'>The selected policy is saved with the plan.</p>
                <button
                    type='button'
                    onClick={workspace.onCreatePlan}
                    disabled={Boolean(workspace.busyAction) || !workspace.importJson.trim() || !mappingsComplete}
                    className={primaryButtonClass}>
                    {workspace.busyAction === 'plan'
                        ? 'Creating plan'
                        : mappingRows.length > 0
                          ? 'Create plan with mappings'
                          : 'Create deployment plan'}
                </button>
            </div>
            <p className='mt-4 max-w-3xl text-xs leading-5 text-[var(--dash-text-subtle)]'>
                Applies supported role updates and channel/category name, position, parent, and permission-overwrite
                changes. Topic, NSFW, slowmode, type changes, and moving @everyone are blocked and remain visible during
                review.
            </p>
        </div>
    );
}

function RunsSurface({
    workspace,
    includeDetails,
}: {
    workspace: DashboardStructurePanelViewProps;
    includeDetails: boolean;
}) {
    return (
        <section aria-labelledby='blueprint-runs-heading' className='mx-auto max-w-[78rem]'>
            <div className='border-b border-[var(--dash-border)] pb-4'>
                <h3 id='blueprint-runs-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                    Deployment runs
                </h3>
                <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>
                    Non-terminal and recoverable work remains visible ahead of completed history.
                </p>
            </div>
            {workspace.importRuns.length === 0 ? (
                <p className='py-10 text-sm text-[var(--dash-text-muted)]'>No deployment plans yet.</p>
            ) : (
                <div role='table' aria-label='Deployment runs'>
                    <div
                        role='row'
                        className='hidden grid-cols-[10rem_minmax(15rem,1fr)_9rem_10rem] gap-4 border-b border-[var(--dash-border)] px-2 py-2 text-xs text-[var(--dash-text-subtle)] md:grid'>
                        <span role='columnheader'>Started</span>
                        <span role='columnheader'>Planned changes</span>
                        <span role='columnheader'>State</span>
                        <span role='columnheader'>Action</span>
                    </div>
                    {workspace.importRuns.map((run) => (
                        <details key={run.id} className='group border-b border-[var(--dash-border)]'>
                            <summary className='grid cursor-pointer list-none gap-2 px-2 py-4 marker:hidden md:grid-cols-[10rem_minmax(15rem,1fr)_9rem_10rem] md:items-center md:gap-4'>
                                <span className='text-sm text-[var(--dash-text-muted)]'>
                                    {formatDate(run.createdAt)}
                                </span>
                                <span className='text-sm text-[var(--dash-text)]'>
                                    {run.actionCount} actions · {run.summary.creates} create · {run.summary.updates}{' '}
                                    update · {run.summary.deletes} delete
                                </span>
                                <span className='text-sm text-[var(--dash-text-muted)]'>{formatRunStatus(run)}</span>
                                <span className='text-sm font-medium text-[var(--dash-primary)]'>
                                    {includeDetails ? 'Open run' : 'Details available'}
                                </span>
                            </summary>
                            {includeDetails ? (
                                <div className='pb-5'>
                                    <DashboardStructureImportHistory
                                        runs={[run]}
                                        latestRun={workspace.latestRun}
                                        busyAction={workspace.busyAction}
                                        preflightByRunId={workspace.preflightByRunId}
                                        deleteConfirmationByRunId={workspace.deleteConfirmationByRunId}
                                        onDeleteConfirmationChange={workspace.onDeleteConfirmationChange}
                                        onApprove={workspace.onApprovePlan}
                                        onPreflight={workspace.onPreflightRun}
                                        onApply={workspace.onApplyRun}
                                        onControl={workspace.onControlExecution}
                                        onLoadActions={workspace.onLoadRunActions}
                                        onLoadDecisions={workspace.onLoadRunDecisions}
                                        onRecoveryPlan={workspace.onRecoveryPlan}
                                    />
                                    {workspace.executionProgressIssue?.runId === run.id ? (
                                        <ExecutionProgressIssue
                                            code={workspace.executionProgressIssue.code}
                                            message='Live progress could not refresh. The last confirmed state remains visible.'
                                            retryLabel='Retry progress'
                                            onRetry={workspace.onRetryExecutionProgress}
                                        />
                                    ) : null}
                                </div>
                            ) : null}
                        </details>
                    ))}
                </div>
            )}
        </section>
    );
}

function getDeployStage(run: DashboardStructureImportRun | undefined): 1 | 2 | 3 | 4 {
    if (!run) return 1;
    if (run.status === 'building' || run.status === 'needs_mapping' || run.status === 'review_ready') return 2;
    if (run.status === 'approved') return 3;
    return 4;
}

function formatRunStatus(run: DashboardStructureImportRun): string {
    switch (run.status) {
        case 'review_ready':
            return 'Waiting for review';
        case 'approved':
            return 'Waiting for safety check';
        default:
            return run.execution?.status.replaceAll('_', ' ') ?? run.status.replaceAll('_', ' ');
    }
}

function ExecutionProgressIssue({
    code,
    message,
    retryLabel,
    onRetry,
}: {
    code: string;
    message: string;
    retryLabel: string;
    onRetry: () => void;
}) {
    return (
        <div className='mt-4 flex flex-wrap items-center justify-between gap-3 border border-amber-400/30 bg-amber-950/20 p-3'>
            <div>
                <p className='text-xs text-amber-100'>{message}</p>
                <p className='mt-1 font-mono text-[11px] text-neutral-500'>Diagnostic: {code}</p>
            </div>
            <button
                type='button'
                onClick={onRetry}
                className='rounded border border-amber-300/40 px-3 py-1.5 text-xs font-semibold text-amber-100'>
                {retryLabel}
            </button>
        </div>
    );
}

const primaryButtonClass =
    'min-h-10 rounded-[var(--dash-radius-control)] bg-[var(--dash-primary)] px-4 text-sm font-semibold text-[#06111a] transition hover:bg-[var(--dash-primary-strong)] disabled:cursor-not-allowed disabled:bg-[var(--dash-surface-raised)] disabled:text-[var(--dash-text-disabled)]';
const secondaryButtonClass =
    'min-h-10 rounded-[var(--dash-radius-control)] border border-[var(--dash-border-interactive)] px-4 text-sm font-semibold text-[var(--dash-text)] transition hover:border-[var(--dash-primary)] hover:text-[var(--dash-primary)] disabled:cursor-not-allowed disabled:border-[var(--dash-border)] disabled:text-[var(--dash-text-disabled)]';

export type DashboardStructurePanelViewProps = {
    backupJson: string;
    backupPage: BackupPageState;
    backupSettings: DashboardStructureBackupSettings;
    busyAction: StructureBusyAction | undefined;
    cadenceDraft: number;
    deleteConfirmBackupId: string | undefined;
    deleteConfirmationByRunId: Record<string, string>;
    driftState: DriftState | undefined;
    editingBackupId: string | undefined;
    editingBackupName: string;
    enabledDraft: boolean;
    executionProgressIssue: { code: string; runId: string } | undefined;
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
    structurePolicy: DashboardStructurePolicy;
    roleMappingConflicts: DashboardStructureRoleMappingConflict[];
    roleMappings: Record<string, string>;
    restoreShortcutBackupId: string | undefined;
    retentionDraft: number;
    settingsRefreshIssue: { code: string } | undefined;
    status: PanelStatus | undefined;
    onApplyRun: (run: DashboardStructureImportRun) => void;
    onControlExecution: (run: DashboardStructureImportRun, request: 'pause' | 'resume' | 'cancel') => void;
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
    onApprovePlan: (run: DashboardStructureImportRun) => void;
    onCreateBackup: () => void;
    onCreatePlan: () => void;
    onCreateRestoreDryRun: (backupId: string) => void;
    onDeleteConfirmationChange: (runId: string, confirmation: string) => void;
    onDownloadCurrentStructure: () => void;
    onDriftCreateDryRun: (backup: DashboardStructureBackupSummary) => void;
    onImportJsonChange: Dispatch<SetStateAction<string>>;
    onImportStructureFile: (file: File | undefined) => Promise<void>;
    onLoadMoreBackups: () => void;
    onLoadRunActions: (run: DashboardStructureImportRun) => void;
    onLoadRunDecisions: (run: DashboardStructureImportRun) => void;
    onPreflightRun: (run: DashboardStructureImportRun) => void;
    onRetryExecutionProgress: () => void;
    onRetrySettingsRefresh: () => void;
    onStructurePolicyChange: (policy: DashboardStructurePolicy) => void;
    onRoleMappingChange: (sourceId: string, targetId: string) => void;
    onRecoveryPlan: (run: DashboardStructureImportRun) => void;
    onSaveBackupSettings: (value: DashboardStructureBackupSettingsValue) => void;
    onSetBackupJsonAsImportJson: () => void;
    onReviewScheduledDrift: (baselineBackupId: string) => void;
};
