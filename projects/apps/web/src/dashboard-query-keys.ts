export function getDashboardGuildCatalogQueryKey() {
    return ['dashboard', 'guild-catalog'] as const;
}

export function getDashboardCommandSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'command-settings'] as const;
}

export function getDashboardAuditEventsBaseQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'audit-events'] as const;
}

export function getDashboardAuditEventsQueryKey(
    guildId: string,
    search = '',
    searchScope = 'all',
    searchOffsetMinutes = 0
) {
    return [...getDashboardAuditEventsBaseQueryKey(guildId), searchScope, searchOffsetMinutes, search] as const;
}

export function getDashboardOverviewQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'overview'] as const;
}

export function getDashboardPostingChannelsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'posting-channels'] as const;
}

export function getDashboardPostingOperationsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'posting-operations'] as const;
}

export function getDashboardPostingTemplatesQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'posting-templates'] as const;
}

export function getDashboardStructureQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'structure'] as const;
}

export function getDashboardStructureStatusQueryKey(guildId: string) {
    return [...getDashboardStructureQueryKey(guildId), 'status'] as const;
}

export function getDashboardStructureBackupsQueryKey(guildId: string) {
    return [...getDashboardStructureQueryKey(guildId), 'backups'] as const;
}

export function getDashboardStructureRunsQueryKey(guildId: string) {
    return [...getDashboardStructureQueryKey(guildId), 'runs'] as const;
}

export function getDashboardStructureExecutionProgressBaseQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'structure-execution-progress'] as const;
}

export function getDashboardStructureExecutionProgressQueryKey(guildId: string, runId: string) {
    return [...getDashboardStructureExecutionProgressBaseQueryKey(guildId), runId] as const;
}
