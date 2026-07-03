export type UniqueKeyRule = {
    fields: readonly string[];
    name: string;
    table: string;
};

export type CounterRule = {
    counterField: string;
    counterTable: string;
    factField: string;
    factTable: string;
    name: string;
    scopeField: string;
};

export type EventOrderingRule = {
    parentField?: string;
    table: string;
    timestampField: string;
};

export const defaultUniqueKeyRules = [
    unique('guilds', ['guildId']),
    unique('botInstallations', ['guildId']),
    unique('deploymentConfig', ['id']),
    unique('guildSecurityPolicies', ['guildId']),
    unique('guildDashboardPermissionRules', ['guildId']),
    unique('webSessions', ['id']),
    unique('fluxerOauthTokens', ['fluxerUserId']),
    unique('moderationCaseCounters', ['guildId']),
    unique('ticketCounters', ['guildId']),
    unique('xpSettings', ['guildId']),
    unique('guildFeatureSettings', ['guildId', 'feature']),
    unique('guildCommandPermissionRules', ['guildId', 'targetType', 'targetId']),
    unique('guildDefconExemptions', ['guildId', 'category']),
    unique('automodRules', ['guildId', 'name']),
    unique('moderationCases', ['guildId', 'caseNumber']),
    unique('guildLoggingDestinations', ['guildId', 'eventGroup']),
    unique('autoroleRules', ['guildId', 'roleId']),
    unique('reactionRoleMessages', ['guildId', 'messageId']),
    unique('reactionRoleOptions', ['reactionRoleMessageLegacyId', 'emojiKey']),
    unique('reactionRoleAssignments', ['guildId', 'messageId', 'userId', 'roleId']),
    unique('verificationRecords', ['guildId', 'userId']),
    unique('verificationFlows', ['guildId', 'messageId']),
    unique('tickets', ['guildId', 'ticketNumber']),
    unique('ticketMembers', ['ticketLegacyId', 'userId']),
    unique('suggestionBoards', ['guildId', 'name']),
    unique('suggestionVotes', ['suggestionLegacyId', 'userId']),
    unique('messageTemplates', ['guildId', 'name']),
    unique('postedMessages', ['guildId', 'channelId', 'messageId']),
    unique('profileForms', ['guildId', 'name']),
    unique('profileFields', ['formLegacyId', 'fieldKey']),
    unique('giveawayEntries', ['giveawayLegacyId', 'userId']),
    unique('giveawayWinners', ['giveawayLegacyId', 'userId', 'drawNumber']),
    unique('guildUserXp', ['guildId', 'userId']),
    unique('xpRoleRewards', ['guildId', 'level', 'roleId']),
    unique('xpGrants', ['guildId', 'idempotencyKey']),
    unique('guildInviteSnapshots', ['guildId', 'code']),
    unique('guildMessageActivityDays', ['guildId', 'channelId', 'activityDate']),
    unique('vcGeneratorRules', ['guildId', 'sourceChannelId']),
    unique('generatedVoiceChannels', ['channelId']),
    unique('vcGeneratorControlPanels', ['guildId', 'ruleLegacyId']),
    unique('vcGeneratorControlPanels', ['guildId', 'messageId']),
] as const satisfies readonly UniqueKeyRule[];

export const defaultCounterRules = [
    {
        counterField: 'nextCaseNumber',
        counterTable: 'moderationCaseCounters',
        factField: 'caseNumber',
        factTable: 'moderationCases',
        name: 'moderation case counter',
        scopeField: 'guildId',
    },
    {
        counterField: 'nextTicketNumber',
        counterTable: 'ticketCounters',
        factField: 'ticketNumber',
        factTable: 'tickets',
        name: 'ticket counter',
        scopeField: 'guildId',
    },
] as const satisfies readonly CounterRule[];

export const defaultEventOrderingRules = [
    eventRule('automodEvents', 'createdAt', 'guildId'),
    eventRule('moderationCaseEvents', 'createdAt', 'caseLegacyId'),
    eventRule('botActionEvents', 'createdAt', 'guildId'),
    eventRule('ticketEvents', 'createdAt', 'ticketLegacyId'),
    eventRule('giveawayEvents', 'createdAt', 'giveawayLegacyId'),
    eventRule('guildMemberFlowEvents', 'occurredAt', 'guildId'),
    eventRule('xpGrants', 'grantedAt', 'guildId'),
] as const satisfies readonly EventOrderingRule[];

function unique(table: string, fields: readonly string[]): UniqueKeyRule {
    return {
        fields,
        name: `${table}.${fields.join('+')}`,
        table,
    };
}

function eventRule(table: string, timestampField: string, parentField?: string): EventOrderingRule {
    return {
        ...(parentField ? { parentField } : {}),
        table,
        timestampField,
    };
}
