import type {
    DashboardStructureBackupSettings,
    DashboardStructureBackupSummary,
} from '../server/dashboard-structure-model.js';

const regularBackupSources = new Set(['manual', 'scheduled']);
const overdueGraceMs = 2 * 60 * 60 * 1000;
const backupSettingsHref = '#server-blueprint-backup-settings';

export type DashboardStructureBackupHealthIssue = {
    detail: string;
    href: string;
    tone: 'error' | 'warning';
    title: string;
    type: 'backup-failed' | 'retention-overdue' | 'scheduled-never-succeeded' | 'scheduled-overdue';
};

export function deriveDashboardStructureBackupHealth({
    backups,
    formatDate,
    nowMs = Date.now(),
    settings,
}: {
    backups: DashboardStructureBackupSummary[];
    formatDate: (value: string) => string;
    nowMs?: number;
    settings: DashboardStructureBackupSettings;
}): DashboardStructureBackupHealthIssue[] {
    const regularBackups = backups.filter((backup) => regularBackupSources.has(backup.source));
    const latestRegularBackup = regularBackups.at(0);
    const failedBackupForLink =
        latestRegularBackup?.status === 'failed'
            ? latestRegularBackup
            : settings.lastErrorMessage
              ? regularBackups.find(isFailedBackup)
              : undefined;
    const issues: DashboardStructureBackupHealthIssue[] = [];

    if (settings.lastErrorMessage || latestRegularBackup?.status === 'failed') {
        const repeatedFailures = regularBackups.slice(0, 2).filter(isFailedBackup).length >= 2;
        issues.push({
            detail: settings.lastErrorMessage ?? failedBackupForLink?.errorMessage ?? 'Latest backup attempt failed.',
            href: failedBackupForLink
                ? `#${buildDashboardStructureBackupRowId(failedBackupForLink.id)}`
                : backupSettingsHref,
            title: repeatedFailures ? 'Repeated backup failures' : 'Latest backup failed',
            tone: 'error',
            type: 'backup-failed',
        });
    }

    if (settings.enabled && !settings.lastSuccessAt) {
        issues.push({
            detail: settings.lastAttemptAt
                ? `Last attempt: ${formatDate(settings.lastAttemptAt)}.`
                : 'No scheduled backup attempt has completed.',
            href: backupSettingsHref,
            title: 'Automatic backups have not succeeded yet.',
            tone: 'warning',
            type: 'scheduled-never-succeeded',
        });
    }

    if (settings.enabled && isOverdue(settings.nextBackupAt, nowMs)) {
        issues.push({
            detail: `Next scheduled backup was due ${formatDate(settings.nextBackupAt)}.`,
            href: backupSettingsHref,
            title: 'Scheduled backup is overdue.',
            tone: 'warning',
            type: 'scheduled-overdue',
        });
    }

    if (isOverdue(settings.nextRetentionPruneAt, nowMs)) {
        issues.push({
            detail: 'Expired backups may remain until the bot processes retention.',
            href: backupSettingsHref,
            title: 'Retention prune is overdue.',
            tone: 'warning',
            type: 'retention-overdue',
        });
    }

    return issues;
}

export function buildDashboardStructureBackupRowId(backupId: string): string {
    const sanitized = backupId
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return `server-blueprint-backup-${sanitized || 'row'}`;
}

function isFailedBackup(backup: DashboardStructureBackupSummary): boolean {
    return backup.status === 'failed';
}

function isOverdue(value: string | undefined, nowMs: number): value is string {
    if (!value) return false;

    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return false;

    return timestamp + overdueGraceMs < nowMs;
}
