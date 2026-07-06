export function getDashboardCommandSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'command-settings'] as const;
}

export function getDashboardReactionRolesSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'reaction-roles-settings'] as const;
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

export function getDashboardPostingTemplatesQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'posting-templates'] as const;
}

export function getDashboardStructureSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'structure-settings'] as const;
}
