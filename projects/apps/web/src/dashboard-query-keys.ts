export function getDashboardCommandSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'command-settings'] as const;
}
