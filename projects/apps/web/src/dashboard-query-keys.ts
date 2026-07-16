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

export function getDashboardPostingCatalogQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'posting-catalog'] as const;
}

export function getDashboardPostingOperationsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'posting-operations'] as const;
}

export function getDashboardPostingTemplatesQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'posting-templates'] as const;
}

export function getDashboardBlueprintQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'blueprint'] as const;
}

export function getDashboardBlueprintStatusQueryKey(guildId: string) {
    return [...getDashboardBlueprintQueryKey(guildId), 'status'] as const;
}

export function getDashboardBlueprintBackupsQueryKey(guildId: string) {
    return [...getDashboardBlueprintQueryKey(guildId), 'backups'] as const;
}

export function getDashboardBlueprintRunsQueryKey(guildId: string) {
    return [...getDashboardBlueprintQueryKey(guildId), 'runs'] as const;
}

export function getDashboardBlueprintRunProgressBaseQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'blueprint-run-progress'] as const;
}

export function getDashboardBlueprintRunProgressQueryKey(guildId: string, planId: string) {
    return [...getDashboardBlueprintRunProgressBaseQueryKey(guildId), planId] as const;
}

export function getDashboardBlueprintPlanAuthorityQueryKey(guildId: string, planId: string) {
    return [...getDashboardBlueprintQueryKey(guildId), 'plan-authority', planId] as const;
}

export function getDashboardBlueprintPreflightEvidenceQueryKey(guildId: string, preflightId: string) {
    return [...getDashboardBlueprintQueryKey(guildId), 'preflight-evidence', preflightId] as const;
}

export function getDashboardBlueprintVerificationEvidenceQueryKey(guildId: string, runId: string) {
    return [...getDashboardBlueprintQueryKey(guildId), 'verification-evidence', runId] as const;
}
