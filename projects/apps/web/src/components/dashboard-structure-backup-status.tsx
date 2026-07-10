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
    return (
        <div>
            <dl className='grid border-y border-[var(--dash-border)] md:grid-cols-3 md:divide-x md:divide-[var(--dash-border)]'>
                <StatusFact
                    label='Last attempt'
                    value={settings.lastAttemptAt ? formatDate(settings.lastAttemptAt) : 'Never'}
                />
                <StatusFact
                    label='Last success'
                    value={settings.lastSuccessAt ? formatDate(settings.lastSuccessAt) : 'Never'}
                />
                <StatusFact label='Backup state' value={backupState} />
            </dl>
            {healthIssues.length > 0 ? (
                <div
                    aria-label='Backup health'
                    className='divide-y divide-[var(--dash-border)] border-b border-[var(--dash-border)]'>
                    {healthIssues.map((issue) => (
                        <div
                            key={issue.type}
                            className='flex flex-wrap items-start justify-between gap-3 border-l-2 border-l-[var(--dash-warning)] px-3 py-3'>
                            <div className='min-w-0'>
                                <p
                                    className={`text-sm font-semibold ${
                                        issue.tone === 'error'
                                            ? 'text-[var(--dash-danger)]'
                                            : 'text-[var(--dash-warning)]'
                                    }`}>
                                    {issue.title}
                                </p>
                                <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>{issue.detail}</p>
                            </div>
                            <a
                                href={issue.href}
                                className='text-xs font-semibold text-[var(--dash-text)] underline decoration-[var(--dash-border-strong)] underline-offset-4 transition hover:decoration-[var(--dash-primary)]'>
                                Review
                            </a>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function StatusFact({ label, value }: { label: string; value: string }) {
    return (
        <div className='px-1 py-3 md:px-4 md:first:pl-0'>
            <dt className='text-xs text-[var(--dash-text-subtle)]'>{label}</dt>
            <dd className='mt-1 text-sm leading-5 text-[var(--dash-text)]'>{value}</dd>
        </div>
    );
}
