import type {
    DashboardStructureBackupSettings,
    DashboardStructureBackupSummary,
} from '../server/dashboard-structure.server.js';
import { deriveDashboardStructureBackupHealth } from './dashboard-structure-backup-health.js';
import { formatDate } from './dashboard-structure-panel-format.js';

export function DashboardStructureBackupStatus({
    backups,
    observedState,
    settings,
}: {
    backups: DashboardStructureBackupSummary[];
    observedState: { changedSinceLastBackup: boolean };
    settings: DashboardStructureBackupSettings;
}) {
    const latestBackup = backups.at(0);
    const latestSuccessfulBackup = backups.find((backup) => backup.status === 'succeeded');
    const healthIssues = deriveDashboardStructureBackupHealth({
        backups,
        formatDate,
        settings,
    });
    const backupState = settings.lastErrorMessage
        ? settings.lastErrorMessage
        : latestBackup?.status === 'failed'
          ? (latestBackup.errorMessage ?? 'Latest backup failed')
          : observedState.changedSinceLastBackup
            ? 'Server layout changed since backup'
            : latestSuccessfulBackup
              ? 'Current backup available'
              : 'No backup yet';
    const backupTone =
        settings.lastErrorMessage || latestBackup?.status === 'failed'
            ? 'error'
            : observedState.changedSinceLastBackup || !latestSuccessfulBackup
              ? 'neutral'
              : 'success';

    return (
        <div className='space-y-3'>
            <div className='grid gap-3 md:grid-cols-3'>
                <StatusTile
                    label='Last attempt'
                    value={settings.lastAttemptAt ? formatDate(settings.lastAttemptAt) : 'Never'}
                />
                <StatusTile
                    label='Last success'
                    value={settings.lastSuccessAt ? formatDate(settings.lastSuccessAt) : 'Never'}
                />
                <StatusTile label='Backup state' value={backupState} tone={backupTone} />
            </div>
            {healthIssues.length > 0 ? (
                <div
                    aria-label='Backup health'
                    className='space-y-2 rounded-md border border-amber-400/20 bg-amber-400/5 p-3'>
                    {healthIssues.map((issue) => (
                        <div
                            key={issue.type}
                            className={`flex flex-wrap items-start justify-between gap-3 rounded-md border px-3 py-2 ${
                                issue.tone === 'error'
                                    ? 'border-rose-400/25 bg-rose-400/10'
                                    : 'border-amber-400/25 bg-amber-400/10'
                            }`}>
                            <div className='min-w-0'>
                                <p
                                    className={`text-sm font-semibold ${
                                        issue.tone === 'error' ? 'text-rose-100' : 'text-amber-100'
                                    }`}>
                                    {issue.title}
                                </p>
                                <p className='mt-1 text-xs leading-5 text-neutral-300'>{issue.detail}</p>
                            </div>
                            <a
                                href={issue.href}
                                className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200'>
                                Review
                            </a>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function StatusTile({
    label,
    value,
    tone = 'neutral',
}: {
    label: string;
    value: string;
    tone?: 'success' | 'error' | 'neutral';
}) {
    const valueClass =
        tone === 'error' ? 'text-rose-200' : tone === 'success' ? 'text-emerald-200' : 'text-neutral-200';

    return (
        <div className='rounded-md border border-neutral-800 bg-neutral-950/60 p-3'>
            <p className='text-xs font-medium text-neutral-500 uppercase'>{label}</p>
            <p className={`mt-2 text-sm leading-5 ${valueClass}`}>{value}</p>
        </div>
    );
}
