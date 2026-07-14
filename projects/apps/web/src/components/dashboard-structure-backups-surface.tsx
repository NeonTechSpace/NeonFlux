import type { Dispatch, SetStateAction } from 'react';

import type {
    DashboardStructureBackupSettings,
    DashboardStructureBackupSummary,
} from '../server/dashboard-structure-model.js';
import type { DashboardStructureBackupSettingsValue } from './dashboard-structure-backup-settings.js';
import { DashboardStructureBackupHistory as BackupHistory } from './dashboard-structure-backup-history.js';
import { DashboardStructureBackupSettings as BackupSettings } from './dashboard-structure-backup-settings.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { formatDate } from './dashboard-structure-panel-format.js';
import type { BackupPageState } from './dashboard-structure-panel-types.js';
import { dashboardStructureSurfaceIdentity as surfaceIdentity } from './dashboard-structure-surface.js';
import { dashboardPrimaryActionClassName, dashboardSecondaryActionClassName } from './dashboard-ui.js';

export type DashboardStructureBackupsWorkspace = {
    backupJson: string;
    backupPage: BackupPageState;
    backupSettings: DashboardStructureBackupSettings;
    busyAction: StructureBusyAction | undefined;
    cadenceDraft: number;
    deleteConfirmBackupId: string | undefined;
    editingBackupId: string | undefined;
    editingBackupName: string;
    enabledDraft: boolean;
    retentionDraft: number;
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
    onCreateBackup: () => void;
    onLoadMoreBackups: () => void;
    onSaveBackupSettings: (value: DashboardStructureBackupSettingsValue) => void;
    onSetBackupJsonAsImportJson: () => void;
};

export function DashboardStructureBackupsSurface({ workspace }: { workspace: DashboardStructureBackupsWorkspace }) {
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
