import type { DashboardBlueprintBackupSummary } from '../server/dashboard-blueprint-model.js';

export function formatCounts(
    value: Pick<DashboardBlueprintBackupSummary, 'roleCount' | 'categoryCount' | 'channelCount'>
) {
    return `${value.roleCount} roles, ${value.categoryCount} categories, ${value.channelCount} channels`;
}

export function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}

export function formatStatus(status: string): string {
    return status.replaceAll('_', ' ');
}

export function formatBackupSource(source: string): string {
    const labels: Record<string, string> = {
        manual: 'Manual',
        restore_point: 'Restore point',
        scheduled: 'Scheduled',
    };

    return labels[source] ?? formatStatus(source);
}

export function formatObservedState(state: {
    observedChangeCount: number;
    lastEventType?: string;
    lastObservedAt?: string;
    changedSinceLastBackup: boolean;
}) {
    const event = state.lastEventType ? formatStatus(state.lastEventType) : 'server layout change';
    const date = state.lastObservedAt ? formatDate(state.lastObservedAt) : undefined;
    const backupNote = state.changedSinceLastBackup ? ' Backup recommended.' : '';

    return `${state.observedChangeCount} observed server layout change${
        state.observedChangeCount === 1 ? '' : 's'
    }. Last: ${event}${date ? ` at ${date}` : ''}.${backupNote}`;
}
