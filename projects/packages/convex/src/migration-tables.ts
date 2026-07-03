export type ConvexMigrationDomain =
    | 'access'
    | 'automod'
    | 'community'
    | 'core'
    | 'growth'
    | 'moderation'
    | 'posting'
    | 'roles'
    | 'structure'
    | 'tickets'
    | 'web-auth';

export type ConvexMigrationRisk = 'high' | 'medium' | 'medium-high';

export type ConvexMigrationTable = {
    convexTable: string;
    domain: ConvexMigrationDomain;
    postgresTable: string;
    risk: ConvexMigrationRisk;
};

export const convexMigrationTables = [
    table('guilds', 'guilds', 'core', 'high'),
    table('bot_installations', 'botInstallations', 'core', 'high'),
    table('deployment_config', 'deploymentConfig', 'core', 'high'),
    table('guild_feature_settings', 'guildFeatureSettings', 'access', 'medium'),
    table('guild_security_policies', 'guildSecurityPolicies', 'access', 'medium'),
    table('guild_command_permission_rules', 'guildCommandPermissionRules', 'access', 'medium'),
    table('guild_dashboard_permission_rules', 'guildDashboardPermissionRules', 'access', 'medium'),
    table('guild_defcon_exemptions', 'guildDefconExemptions', 'access', 'medium'),
    table('web_sessions', 'webSessions', 'web-auth', 'high'),
    table('fluxer_oauth_tokens', 'fluxerOauthTokens', 'web-auth', 'high'),
    table('automod_rules', 'automodRules', 'automod', 'medium-high'),
    table('automod_events', 'automodEvents', 'automod', 'medium-high'),
    table('moderation_cases', 'moderationCases', 'moderation', 'high'),
    table('moderation_case_counters', 'moderationCaseCounters', 'moderation', 'high'),
    table('moderation_case_events', 'moderationCaseEvents', 'moderation', 'high'),
    table('moderation_temporary_actions', 'moderationTemporaryActions', 'moderation', 'high'),
    table('bot_action_events', 'botActionEvents', 'core', 'medium-high'),
    table('guild_logging_destinations', 'guildLoggingDestinations', 'access', 'medium'),
    table('autorole_rules', 'autoroleRules', 'roles', 'high'),
    table('reaction_role_messages', 'reactionRoleMessages', 'roles', 'high'),
    table('reaction_role_options', 'reactionRoleOptions', 'roles', 'high'),
    table('reaction_role_assignments', 'reactionRoleAssignments', 'roles', 'high'),
    table('verification_records', 'verificationRecords', 'roles', 'high'),
    table('verification_flows', 'verificationFlows', 'roles', 'high'),
    table('ticket_panels', 'ticketPanels', 'tickets', 'medium-high'),
    table('ticket_counters', 'ticketCounters', 'tickets', 'medium-high'),
    table('tickets', 'tickets', 'tickets', 'medium-high'),
    table('ticket_members', 'ticketMembers', 'tickets', 'medium-high'),
    table('ticket_events', 'ticketEvents', 'tickets', 'medium-high'),
    table('suggestion_boards', 'suggestionBoards', 'community', 'medium'),
    table('suggestions', 'suggestions', 'community', 'medium'),
    table('suggestion_votes', 'suggestionVotes', 'community', 'medium'),
    table('message_templates', 'messageTemplates', 'posting', 'medium'),
    table('posted_messages', 'postedMessages', 'posting', 'medium'),
    table('profile_forms', 'profileForms', 'community', 'medium'),
    table('profile_fields', 'profileFields', 'community', 'medium'),
    table('profile_submissions', 'profileSubmissions', 'community', 'medium'),
    table('profile_submission_reviews', 'profileSubmissionReviews', 'community', 'medium'),
    table('giveaways', 'giveaways', 'community', 'high'),
    table('giveaway_entries', 'giveawayEntries', 'community', 'high'),
    table('giveaway_winners', 'giveawayWinners', 'community', 'high'),
    table('giveaway_events', 'giveawayEvents', 'community', 'high'),
    table('xp_settings', 'xpSettings', 'growth', 'high'),
    table('guild_user_xp', 'guildUserXp', 'growth', 'high'),
    table('xp_role_rewards', 'xpRoleRewards', 'growth', 'high'),
    table('xp_grants', 'xpGrants', 'growth', 'high'),
    table('xp_voice_sessions', 'xpVoiceSessions', 'growth', 'high'),
    table('guild_member_flow_events', 'guildMemberFlowEvents', 'growth', 'high'),
    table('guild_invite_snapshots', 'guildInviteSnapshots', 'growth', 'high'),
    table('guild_message_activity_days', 'guildMessageActivityDays', 'growth', 'high'),
    table('vc_generator_rules', 'vcGeneratorRules', 'community', 'high'),
    table('generated_voice_channels', 'generatedVoiceChannels', 'community', 'high'),
    table('vc_generator_control_panels', 'vcGeneratorControlPanels', 'community', 'high'),
    table('vc_generator_control_requests', 'vcGeneratorControlRequests', 'community', 'high'),
    table('role_reconciliation_runs', 'roleReconciliationRuns', 'roles', 'high'),
    table('role_reconciliation_actions', 'roleReconciliationActions', 'roles', 'high'),
    table('structure_export_snapshots', 'structureExportSnapshots', 'structure', 'high'),
    table('structure_import_runs', 'structureImportRuns', 'structure', 'high'),
    table('structure_import_actions', 'structureImportActions', 'structure', 'high'),
] as const satisfies ConvexMigrationTable[];

export const convexMigrationTableCount = convexMigrationTables.length;

function table(
    postgresTable: string,
    convexTable: string,
    domain: ConvexMigrationDomain,
    risk: ConvexMigrationRisk
): ConvexMigrationTable {
    return {
        convexTable,
        domain,
        postgresTable,
        risk,
    };
}
