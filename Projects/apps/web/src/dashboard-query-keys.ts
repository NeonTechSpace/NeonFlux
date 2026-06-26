export function getDashboardCommandSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'command-settings'] as const;
}

export function getDashboardAuditEventsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'audit-events'] as const;
}

export function getDashboardPostingChannelsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'posting-channels'] as const;
}
