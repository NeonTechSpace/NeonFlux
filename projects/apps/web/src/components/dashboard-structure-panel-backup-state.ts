import type { DashboardStructureBackupSummary } from '../server/dashboard-structure-model.js';
import type { BackupPageState } from './dashboard-structure-panel-types.js';

function buildBackupFreshnessSignature(backups: readonly DashboardStructureBackupSummary[]): string {
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
    freshFirstPage: readonly DashboardStructureBackupSummary[]
): boolean {
    return (
        buildBackupFreshnessSignature(page.backups.slice(0, freshFirstPage.length)) ===
        buildBackupFreshnessSignature(freshFirstPage)
    );
}
