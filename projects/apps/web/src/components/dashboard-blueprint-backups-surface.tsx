import type { Dispatch, SetStateAction } from 'react';

import type {
    DashboardBlueprintBackupSettings,
    DashboardBlueprintBackupSummary,
} from '../server/dashboard-blueprint-model.js';
import type { DashboardBlueprintBackupSettingsValue } from './dashboard-blueprint-backup-settings.js';
import { DashboardBlueprintBackupHistory as BackupHistory } from './dashboard-blueprint-backup-history.js';
import { DashboardBlueprintBackupSettings as BackupSettings } from './dashboard-blueprint-backup-settings.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';
import { formatDate } from './dashboard-blueprint-panel-format.js';
import type { BackupPageState } from './dashboard-blueprint-panel-types.js';
import { dashboardBlueprintSurfaceIdentity as surfaceIdentity } from './dashboard-blueprint-surface.js';
import { dashboardPrimaryActionClassName, dashboardSecondaryActionClassName } from './dashboard-ui.js';

export type DashboardBlueprintBackupsWorkspace = {
    backupJson: string;
    backupPage: BackupPageState;
    backupSettings: DashboardBlueprintBackupSettings;
    busyAction: BlueprintBusyAction | undefined;
    cadenceDraft: number;
    deleteConfirmBackupId: string | undefined;
    editingBackupId: string | undefined;
    editingBackupName: string;
    enabledDraft: boolean;
    retentionDraft: number;
    onBackupCadenceWeeksChange: Dispatch<SetStateAction<number | undefined>>;
    onBackupDelete: (backup: DashboardBlueprintBackupSummary) => void;
    onBackupDownload: (backup: DashboardBlueprintBackupSummary) => void;
    onBackupEnabledChange: Dispatch<SetStateAction<boolean | undefined>>;
    onBackupImport: (backup: DashboardBlueprintBackupSummary) => void;
    onBackupInspect: (backup: DashboardBlueprintBackupSummary) => void;
    onBackupRename: (backup: DashboardBlueprintBackupSummary) => void;
    onBackupRenameNameChange: Dispatch<SetStateAction<string>>;
    onBackupRetentionDaysChange: Dispatch<SetStateAction<number | undefined>>;
    onBeginBackupRename: (backup: DashboardBlueprintBackupSummary) => void;
    onCancelBackupDelete: () => void;
    onCancelBackupRename: () => void;
    onCheckBackupDrift: (backup: DashboardBlueprintBackupSummary) => void;
    onCreateBackup: () => void;
    onLoadMoreBackups: () => void;
    onSaveBackupSettings: (value: DashboardBlueprintBackupSettingsValue) => void;
    onSetBackupJsonAsImportJson: () => void;
};

export function DashboardBlueprintBackupsSurface({ workspace }: { workspace: DashboardBlueprintBackupsWorkspace }) {
    const scheduleCopy = workspace.backupSettings.enabled
        ? `Automatic backup every ${workspace.backupSettings.cadenceWeeks === 1 ? 'week' : `${workspace.backupSettings.cadenceWeeks} weeks`} · keep ${workspace.backupSettings.retentionDays} days${workspace.backupSettings.nextBackupAt ? ` · next ${formatDate(workspace.backupSettings.nextBackupAt)}` : ''}`
        : 'Automatic backups are off.';

    return (
        <section aria-labelledby='blueprint-backups-heading'>
            <div className='flex flex-wrap items-end justify-between gap-4 border-b border-[var(--dash-border)] pb-4'>
                <div>
                    <h2 id='blueprint-backups-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                        {surfaceIdentity.backups.heading}
                    </h2>
                    <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>{surfaceIdentity.backups.description}</p>
                    <p className='mt-1 text-xs text-[var(--dash-text-subtle)]'>{scheduleCopy}</p>
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
