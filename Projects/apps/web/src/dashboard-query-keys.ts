export function getDashboardCommandSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'command-settings'] as const;
}

export function getDashboardCommandAccessQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'command-access'] as const;
}

export function getDashboardAutoroleSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'autorole-settings'] as const;
}

export function getDashboardReactionRolesSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'reaction-roles-settings'] as const;
}

export function getDashboardVerificationSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'verification-settings'] as const;
}

export function getDashboardRoleReconciliationSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'role-reconciliation-settings'] as const;
}

export function getDashboardXpSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'xp-settings'] as const;
}

export function getDashboardVcGeneratorSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'vc-generator-settings'] as const;
}

export function getDashboardTicketsSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'tickets-settings'] as const;
}

export function getDashboardSuggestionsSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'suggestions-settings'] as const;
}

export function getDashboardProfileBuilderSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'profile-builder-settings'] as const;
}

export function getDashboardGiveawaysSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'giveaways-settings'] as const;
}

export function getDashboardAuditEventsQueryKey(
    guildId: string,
    search = '',
    searchScope = 'all',
    searchOffsetMinutes = 0
) {
    return ['dashboard', 'guild', guildId, 'audit-events', searchScope, searchOffsetMinutes, search] as const;
}

export function getDashboardOverviewQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'overview'] as const;
}

export function getDashboardModerationCasesQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'moderation-cases'] as const;
}

export function getDashboardModerationPolicyQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'moderation-policy'] as const;
}

export function getDashboardAutomodSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'automod-settings'] as const;
}

export function getDashboardLoggingSettingsQueryKey(guildId: string) {
    return ['dashboard', 'guild', guildId, 'logging-settings'] as const;
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
