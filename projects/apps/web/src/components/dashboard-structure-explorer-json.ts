import type { DashboardStructureExplorerSnapshot } from './dashboard-structure-explorer-snapshot.js';

export function formatDashboardStructureExplorerSnapshotJson(snapshot: DashboardStructureExplorerSnapshot): string {
    return `${JSON.stringify(sortJsonValue(snapshot), null, 2)}\n`;
}

function sortJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortJsonValue);
    if (!value || typeof value !== 'object') return value;

    const sortedEntries = Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortJsonValue(entryValue)] as const);

    return Object.fromEntries(sortedEntries);
}
