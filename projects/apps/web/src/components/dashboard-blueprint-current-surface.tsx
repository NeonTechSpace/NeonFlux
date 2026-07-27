import { motion } from 'motion/react';

import type { DashboardBlueprintBackupSettings } from '../server/dashboard-blueprint-model.js';
import { DashboardBlueprintBackupStatus as BackupStatus } from './dashboard-blueprint-backup-status.js';
import type { BlueprintBusyAction, BackupPageState, DriftState } from './dashboard-blueprint-panel-types.js';
import { dashboardConfirmationTransition, dashboardConfirmationVariants } from './dashboard-motion.js';
import { formatDate, formatObservedState } from './dashboard-blueprint-panel-format.js';
import { dashboardBlueprintSurfaceIdentity as surfaceIdentity } from './dashboard-blueprint-surface.js';
import { dashboardPrimaryActionClassName, dashboardSecondaryActionClassName } from './dashboard-ui.js';

export type DashboardBlueprintCurrentWorkspace = {
    backupPage: BackupPageState;
    backupSettings: DashboardBlueprintBackupSettings;
    busyAction: BlueprintBusyAction | undefined;
    driftState: DriftState | undefined;
    observedState: {
        observedChangeCount: number;
        lastEventType?: string;
        lastObservedAt?: string;
        changedSinceLastBackup: boolean;
    };
    onCheckLatestDrift: () => void;
    onCreateBackup: () => void;
    onDownloadCurrentStructure: () => void;
    onInspectCurrentLayout: () => void;
};

export function DashboardBlueprintCurrentSurface({ workspace }: { workspace: DashboardBlueprintCurrentWorkspace }) {
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
                        {surfaceIdentity.current.heading}
                    </h2>
                    <p className='mt-1 max-w-2xl text-sm leading-6 text-[var(--dash-text-muted)]'>
                        {surfaceIdentity.current.description}
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
