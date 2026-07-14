import { motion } from 'motion/react';
import type { Dispatch, SetStateAction } from 'react';

import type {
    DashboardStructureBackupSettings,
    DashboardStructureBackupSummary,
    DashboardStructureImportRun,
    DashboardStructureRoleMappingConflict,
} from '../server/dashboard-structure.server.js';
import { formatDashboardStructureExecutionState } from '../server/dashboard-structure-contracts.js';
import type { DashboardStructurePolicy } from '../server/dashboard-structure-contracts.js';
import { DashboardStructureBackupHistory as BackupHistory } from './dashboard-structure-backup-history.js';
import { DashboardStructureBackupSettings as BackupSettings } from './dashboard-structure-backup-settings.js';
import type { DashboardStructureBackupSettingsValue } from './dashboard-structure-backup-settings.js';
import { DashboardStructureBackupStatus as BackupStatus } from './dashboard-structure-backup-status.js';
import { DashboardStructureDriftPanel as DriftPanel } from './dashboard-structure-drift-panel.js';
import {
    canStartNewBlueprintDeployment,
    getDashboardStructureDeployStage,
} from './dashboard-structure-deploy-stage.js';
import { DashboardStructureExplorer } from './dashboard-structure-explorer.js';
import { DashboardStructureImportHistory } from './dashboard-structure-import-history.js';
import {
    dashboardCompactFieldClassName,
    dashboardFieldClassName,
    dashboardPrimaryActionClassName,
    dashboardSecondaryActionClassName,
    DashboardStatus,
} from './dashboard-ui.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import {
    dashboardConfirmationTransition,
    dashboardConfirmationVariants,
    dashboardContentVariants,
    dashboardRouteTransition,
    dashboardTactile,
} from './dashboard-motion.js';
import type { DashboardStructureProgressTransport } from './dashboard-structure-execution-progress.js';
import type { DashboardStructureExplorerPanelState } from './dashboard-structure-panel-explorer-state.js';
import { formatDate, formatObservedState } from './dashboard-structure-panel-format.js';
import { RestorePointShortcutNotice, StatusMessage } from './dashboard-structure-panel-shared.js';
import type {
    BackupPageState,
    DashboardStructurePreflightView,
    DriftState,
    PanelStatus,
} from './dashboard-structure-panel-types.js';

export type DashboardStructureSurface = 'current' | 'backups' | 'compare' | 'deploy' | 'runs';

const dashboardStructureDeploymentPolicies = [
    {
        value: 'merge',
        label: 'Merge without deletions',
        description:
            'Create missing items and update matching names, permissions, parents, and order without deleting target-only items.',
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
}: DashboardStructurePanelViewProps & { surface: DashboardStructureSurface }) {
    const refreshIssue = workspace.settingsRefreshIssue ? (
        <ExecutionProgressIssue
            code={workspace.settingsRefreshIssue.code}
            message='Blueprint data could not refresh. The last confirmed workspace remains visible.'
            retryLabel='Retry Blueprint refresh'
            onRetry={workspace.onRetrySettingsRefresh}
        />
    ) : null;
    return (
        <motion.div
            key={surface}
            data-dashboard-motion='route-arrival'
            variants={dashboardContentVariants}
            initial='initial'
            animate='enter'
            transition={dashboardRouteTransition}>
            {refreshIssue}
            {workspace.status ? (
                <div className='mb-5'>
                    <StatusMessage status={workspace.status} />
                </div>
            ) : null}
            {surface === 'current' ? <CurrentSurface workspace={workspace} /> : null}
            {surface === 'backups' ? <BackupsSurface workspace={workspace} /> : null}
            {surface === 'compare' ? <CompareSurface workspace={workspace} /> : null}
            {surface === 'deploy' ? <DeploySurface workspace={workspace} /> : null}
            {surface === 'runs' ? <RunsSurface workspace={workspace} includeDetails /> : null}
        </motion.div>
    );
}

function CurrentSurface({ workspace }: { workspace: DashboardStructurePanelViewProps }) {
    const latestBackup = workspace.backupPage.backups.find(
        (backup) => backup.status === 'succeeded' && backup.source !== 'restore_point'
    );
    const hasBackupAttempt = Boolean(
        workspace.backupPage.backups.length > 0 ||
        workspace.backupSettings.lastAttemptAt ||
        workspace.backupSettings.lastErrorMessage
    );
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
        <section aria-labelledby='blueprint-current-heading'>
            <div className='flex flex-wrap items-end justify-between gap-5 border-b border-[var(--dash-border)] pb-5'>
                <div>
                    <h2 id='blueprint-current-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                        Blueprint overview
                    </h2>
                    <p className='mt-1 max-w-2xl text-sm leading-6 text-[var(--dash-text-muted)]'>
                        Backup health and observed activity. Inspecting the live layout performs a fresh server read.
                    </p>
                </div>
                <div className='flex flex-wrap gap-2'>
                    <button
                        type='button'
                        onClick={workspace.onInspectCurrentLayout}
                        disabled={Boolean(workspace.busyAction)}
                        className={dashboardSecondaryActionClassName}>
                        {workspace.busyAction === 'explorer-live' ? 'Reading live layout' : 'Inspect live layout'}
                    </button>
                    <button
                        type='button'
                        onClick={workspace.onDownloadCurrentStructure}
                        disabled={Boolean(workspace.busyAction)}
                        className={dashboardSecondaryActionClassName}>
                        {workspace.busyAction === 'export' ? 'Preparing JSON' : 'Download JSON'}
                    </button>
                    <button
                        type='button'
                        onClick={latestBackup ? workspace.onCheckLatestDrift : workspace.onCreateBackup}
                        disabled={Boolean(workspace.busyAction)}
                        className={dashboardPrimaryActionClassName}>
                        {latestBackup ? 'Check differences' : 'Create first backup'}
                    </button>
                </div>
            </div>

            {latestBackup ? (
                <>
                    <div className='grid border-b border-[var(--dash-border)] lg:grid-cols-[1fr_auto_1fr_auto_1fr]'>
                        <VersionPoint
                            label='Protected version'
                            title={latestBackup.name}
                            detail={formatDate(latestBackup.completedAt)}
                        />
                        <VersionConnector />
                        <VersionPoint label='Observed activity' title={observedCopy} detail={driftCopy} />
                        <VersionConnector />
                        <VersionPoint
                            label='Baseline contents'
                            title={
                                workspace.observedState.changedSinceLastBackup
                                    ? 'Live layout may have changed'
                                    : 'Latest saved baseline'
                            }
                            detail={`${latestBackup.roleCount} roles · ${latestBackup.categoryCount} categories · ${latestBackup.channelCount} channels in baseline`}
                        />
                    </div>
                    <div className='py-6'>
                        <BackupStatus
                            backups={workspace.backupPage.backups}
                            observedState={workspace.observedState}
                            settings={workspace.backupSettings}
                        />
                    </div>
                </>
            ) : (
                <>
                    <div className='border-b border-[var(--dash-border)] py-8'>
                        <p className='text-sm font-semibold text-[var(--dash-text)]'>
                            Start with one protected version
                        </p>
                        <p className='mt-1 max-w-2xl text-sm leading-6 text-[var(--dash-text-muted)]'>
                            A backup becomes the comparison baseline and a recovery source without changing the live
                            server.
                        </p>
                    </div>
                    {hasBackupAttempt ? (
                        <div className='py-6'>
                            <BackupStatus
                                backups={workspace.backupPage.backups}
                                observedState={workspace.observedState}
                                settings={workspace.backupSettings}
                            />
                        </div>
                    ) : null}
                </>
            )}
        </section>
    );
}

function VersionPoint({ label, title, detail }: { label: string; title: string; detail: string }) {
    return (
        <div className='min-w-0 py-5 lg:px-4 lg:first:pl-0 lg:last:pr-0'>
            <p className='text-xs font-medium text-[var(--dash-text-subtle)]'>{label}</p>
            <motion.p
                key={title}
                data-dashboard-motion='confirmation'
                className='mt-2 text-sm font-semibold text-[var(--dash-text)]'
                variants={dashboardConfirmationVariants}
                initial='initial'
                animate='enter'
                transition={dashboardConfirmationTransition}>
                {title}
            </motion.p>
            <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>{detail}</p>
        </div>
    );
}

function VersionConnector() {
    return <div className='hidden w-px self-stretch bg-[var(--dash-border)] lg:block' aria-hidden='true' />;
}

function BackupsSurface({ workspace }: { workspace: DashboardStructurePanelViewProps }) {
    const scheduleCopy = workspace.backupSettings.enabled
        ? `Automatic backup every ${workspace.backupSettings.cadenceWeeks === 1 ? 'week' : `${workspace.backupSettings.cadenceWeeks} weeks`} · keep ${workspace.backupSettings.retentionDays} days${workspace.backupSettings.nextBackupAt ? ` · next ${formatDate(workspace.backupSettings.nextBackupAt)}` : ''}`
        : 'Automatic backups are off.';

    return (
        <section aria-labelledby='blueprint-backups-heading'>
            <div className='flex flex-wrap items-end justify-between gap-4 border-b border-[var(--dash-border)] pb-4'>
                <div>
                    <h2 id='blueprint-backups-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                        Protected versions
                    </h2>
                    <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>{scheduleCopy}</p>
                </div>
                <div className='flex flex-wrap gap-2'>
                    <button
                        type='button'
                        onClick={workspace.onCreateBackup}
                        disabled={Boolean(workspace.busyAction)}
                        className={dashboardPrimaryActionClassName}>
                        {workspace.busyAction === 'backup' ? 'Creating backup' : 'Create backup'}
                    </button>
                </div>
            </div>

            <details className='group border-b border-[var(--dash-border)]'>
                <summary
                    data-dashboard-disclosure
                    className='flex min-h-12 cursor-pointer list-none items-center justify-between text-sm font-medium text-[var(--dash-text)] marker:hidden'>
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
                        className={dashboardSecondaryActionClassName}>
                        Use as deploy source
                    </button>
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
                    <h2 id='blueprint-compare-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                        Compare layouts
                    </h2>
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
                onCreateDryRun={(backup) => workspace.onCreateRestoreDryRun(backup.id)}
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
            </div>
        </section>
    );
}

function DeploySurface({ workspace }: { workspace: DashboardStructurePanelViewProps }) {
    const stage = workspace.deployChoosingSource ? 1 : getDashboardStructureDeployStage(workspace.deployRun);

    return (
        <section aria-labelledby='blueprint-deploy-heading'>
            <div className='border-b border-[var(--dash-border)] pb-4'>
                <h2 id='blueprint-deploy-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                    Deploy a blueprint
                </h2>
                <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>
                    Choose the intended result, review every change, then apply with a fresh safety check.
                </p>
            </div>
            <ol className='grid grid-cols-3 border-b border-[var(--dash-border)]' aria-label='Deployment stages'>
                {['Choose', 'Review', 'Apply'].map((label, index) => (
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

            {stage === 1 ? <DeploySource workspace={workspace} forceDetailsOpen={false} /> : null}
            {stage > 1 && workspace.deployRun ? (
                <div className='pt-6'>
                    <DashboardStructureImportHistory
                        runs={[workspace.deployRun]}
                        latestRun={workspace.deployRun}
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
            {stage > 1 && canStartNewBlueprintDeployment(workspace.deployRun) ? (
                <div className='mt-6 border-y border-[var(--dash-border)]'>
                    <button
                        type='button'
                        onClick={workspace.onStartNewBlueprintDeployment}
                        className='w-full py-4 text-left text-sm font-semibold text-[var(--dash-primary)]'>
                        Start over with another blueprint
                    </button>
                </div>
            ) : null}
            {workspace.executionProgressIssue ? (
                <ExecutionProgressIssue
                    code={workspace.executionProgressIssue.code}
                    message={formatExecutionProgressIssue(workspace.executionProgressIssue.code)}
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
                onClick={(event) => {
                    event.currentTarget.value = '';
                }}
                onChange={(event) => {
                    void workspace.onImportStructureFile(event.currentTarget.files?.[0]);
                }}
                className='mt-3 block w-full max-w-2xl bg-transparent px-0 py-3 text-sm text-[var(--dash-text-muted)] file:mr-4 file:rounded-[var(--dash-radius-control)] file:border-0 file:bg-[var(--dash-surface-raised)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--dash-text)] hover:file:bg-[var(--dash-surface-selected)]'
            />
            <details
                className='mt-4 max-w-2xl border-y border-[var(--dash-border)]'
                open={forceDetailsOpen || undefined}>
                <summary
                    data-dashboard-disclosure
                    className='cursor-pointer list-none py-3 text-sm font-medium text-[var(--dash-text)] marker:hidden'>
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
                        className={`${dashboardFieldClassName} resize-y py-2 font-mono text-xs`}
                        placeholder='Paste normalized Server Blueprint JSON.'
                    />
                    <button
                        type='button'
                        onClick={workspace.onInspectImportJson}
                        disabled={!workspace.importJson.trim() || Boolean(workspace.busyAction)}
                        className={`mt-3 ${dashboardSecondaryActionClassName}`}>
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
                                className={`flex cursor-pointer items-start gap-3 rounded-[var(--dash-radius-control)] border p-4 transition-[border-color,background-color,box-shadow] focus-within:shadow-[var(--dash-shadow-focus)] ${
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
                    className='mt-5 max-w-2xl rounded-[var(--dash-radius-control)] border border-[color:var(--dash-warning)]/35 bg-[var(--dash-warning-soft)] p-4'
                    role='alert'>
                    <h4 className='text-sm font-semibold text-[var(--dash-warning)]'>
                        Match duplicate blueprint items
                    </h4>
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
                                    className={dashboardCompactFieldClassName}>
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
                <p className='text-xs text-[var(--dash-text-muted)]'>
                    Nothing changes until the reviewed result is applied.
                </p>
                <button
                    type='button'
                    onClick={workspace.onCreatePlan}
                    disabled={Boolean(workspace.busyAction) || !workspace.importJson.trim() || !mappingsComplete}
                    className={dashboardPrimaryActionClassName}>
                    {workspace.busyAction === 'plan'
                        ? 'Preparing preview'
                        : mappingRows.length > 0
                          ? 'Preview changes with mappings'
                          : 'Preview exact changes'}
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
        <section aria-labelledby='blueprint-runs-heading'>
            <div className='border-b border-[var(--dash-border)] pb-4'>
                <h2 id='blueprint-runs-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                    Deployment runs
                </h2>
                <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>
                    Active work stays at the top; completed runs follow.
                </p>
            </div>
            {workspace.importRuns.length === 0 ? (
                <p className='py-10 text-sm text-[var(--dash-text-muted)]'>No deployment plans yet.</p>
            ) : (
                <div role='list' aria-label='Deployment runs'>
                    <div
                        aria-hidden='true'
                        className='hidden grid-cols-[10rem_minmax(15rem,1fr)_9rem_10rem] gap-4 border-b border-[var(--dash-border)] px-2 py-2 text-xs text-[var(--dash-text-subtle)] md:grid'>
                        <span>Started</span>
                        <span>Planned changes</span>
                        <span>State</span>
                        <span>Action</span>
                    </div>
                    {workspace.importRuns.map((run) => (
                        <details key={run.id} role='listitem' className='group border-b border-[var(--dash-border)]'>
                            <motion.summary
                                data-dashboard-disclosure
                                className='grid cursor-pointer list-none gap-2 px-2 py-4 marker:hidden md:grid-cols-[10rem_minmax(15rem,1fr)_9rem_10rem] md:items-center md:gap-4'
                                {...dashboardTactile}>
                                <span className='text-sm text-[var(--dash-text-muted)]'>
                                    {formatDate(run.createdAt)}
                                </span>
                                <span className='text-sm text-[var(--dash-text)]'>
                                    {run.actionCount} changes · {run.executionActionCount} execution steps ·{' '}
                                    {run.summary.creates} create · {run.summary.updates} update · {run.summary.deletes}{' '}
                                    delete
                                </span>
                                <span className='text-sm text-[var(--dash-text-muted)]'>{formatRunStatus(run)}</span>
                                <span className='text-sm font-medium text-[var(--dash-primary)]'>
                                    {includeDetails ? 'Open run' : 'Details available'}
                                </span>
                            </motion.summary>
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
                                            message={formatExecutionProgressIssue(
                                                workspace.executionProgressIssue.code
                                            )}
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

function formatRunStatus(run: DashboardStructureImportRun): string {
    if (run.execution) {
        switch (run.execution.status) {
            case 'succeeded':
                return 'Applied and verified';
            case 'partially_applied':
                return 'Partially applied';
            case 'failed_before_mutation':
                return 'Stopped before server changes';
            case 'needs_reconciliation':
                return 'Reconciliation required';
            case 'outcome_unknown':
                return 'Server outcome unknown';
            case 'cancelled':
                return 'Cancelled';
            default:
                return formatDashboardStructureExecutionState(run.execution);
        }
    }

    switch (run.status) {
        case 'review_ready':
            return 'Waiting for review';
        case 'approved':
            return 'Waiting for safety check';
        default:
            return run.status.replaceAll('_', ' ');
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
    const retryable =
        code !== 'BLUEPRINT_EXECUTION_PROTOCOL_INCOMPATIBLE' &&
        code !== 'BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE' &&
        code !== 'BLUEPRINT_LOAD_BACKEND_INCOMPATIBLE';

    return (
        <DashboardStatus
            tone='warning'
            actions={
                retryable ? (
                    <button
                        type='button'
                        onClick={onRetry}
                        className={`${dashboardSecondaryActionClassName} min-h-8 text-xs`}>
                        {retryLabel}
                    </button>
                ) : undefined
            }>
            <div>
                <p className='text-xs'>{message}</p>
                <details className='mt-1 text-[11px] text-[var(--dash-text-subtle)]'>
                    <summary className='cursor-pointer rounded-sm focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                        Technical details
                    </summary>
                    <code className='mt-1 block'>{code}</code>
                </details>
            </div>
        </DashboardStatus>
    );
}

function formatExecutionProgressIssue(code: string): string {
    if (code === 'BLUEPRINT_EXECUTION_PROTOCOL_INCOMPATIBLE') {
        return 'This deployment was created by a different Blueprint protocol. Its last confirmed state remains visible, but this build will not resume or control it.';
    }
    if (code === 'BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE') {
        return 'Deployment progress is unavailable because the Convex backend does not match this NeonFlux build. Deploy the matching backend before continuing.';
    }
    return 'Deployment progress could not refresh. The last confirmed state remains visible.';
}

export type DashboardStructurePanelViewProps = {
    backupJson: string;
    backupPage: BackupPageState;
    backupSettings: DashboardStructureBackupSettings;
    busyAction: StructureBusyAction | undefined;
    cadenceDraft: number;
    deleteConfirmBackupId: string | undefined;
    deleteConfirmationByRunId: Record<string, string>;
    driftState: DriftState | undefined;
    deployChoosingSource: boolean;
    deployRun: DashboardStructureImportRun | undefined;
    editingBackupId: string | undefined;
    editingBackupName: string;
    enabledDraft: boolean;
    executionProgressIssue: { code: string; runId: string } | undefined;
    executionTransport: DashboardStructureProgressTransport;
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
    preflightByRunId: Record<string, DashboardStructurePreflightView>;
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
    onImportJsonChange: Dispatch<SetStateAction<string>>;
    onImportStructureFile: (file: File | undefined) => Promise<void>;
    onInspectCurrentLayout: () => void;
    onInspectImportJson: () => void;
    onLoadMoreBackups: () => void;
    onLoadRunActions: (run: DashboardStructureImportRun) => void;
    onLoadRunDecisions: (run: DashboardStructureImportRun) => void;
    onPreflightRun: (run: DashboardStructureImportRun) => void;
    onRetryExecutionProgress: () => void;
    onRetrySettingsRefresh: () => void;
    onStartNewBlueprintDeployment: () => void;
    onStructurePolicyChange: (policy: DashboardStructurePolicy) => void;
    onRoleMappingChange: (sourceId: string, targetId: string) => void;
    onRecoveryPlan: (run: DashboardStructureImportRun) => void;
    onSaveBackupSettings: (value: DashboardStructureBackupSettingsValue) => void;
    onSetBackupJsonAsImportJson: () => void;
    onReviewScheduledDrift: (baselineBackupId: string) => void;
};
