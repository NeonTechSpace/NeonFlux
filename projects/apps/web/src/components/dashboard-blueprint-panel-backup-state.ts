import type { DashboardBlueprintBackupSummary } from '../server/dashboard-blueprint-model.js';
import type { BackupPageState } from './dashboard-blueprint-panel-types.js';

function buildBackupFreshnessSignature(backups: readonly DashboardBlueprintBackupSummary[]): string {
    return backups
        .map((backup) =>
            [
                backup.id,
                backup.name,
                backup.source,
                backup.status,
                backup.createdAt,
                backup.completedAt,
                backup.errorMessage ?? '',
            ].join(':')
        )
        .join('|');
}

export function isBackupPageStateFresh(
    page: BackupPageState,
    freshFirstPage: readonly DashboardBlueprintBackupSummary[]
): boolean {
    return (
        buildBackupFreshnessSignature(page.backups.slice(0, freshFirstPage.length)) ===
        buildBackupFreshnessSignature(freshFirstPage)
    );
}
