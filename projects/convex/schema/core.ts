import { guildsTable } from './tables/guilds.js';
import { botInstallationsTable } from './tables/bot_installations.js';
import { deploymentConfigTable } from './tables/deployment_config.js';
import { guildFeatureSettingsTable } from './tables/guild_feature_settings.js';
import { guildSecurityPoliciesTable } from './tables/guild_security_policies.js';
import { guildCommandPermissionRulesTable } from './tables/guild_command_permission_rules.js';
import { guildDashboardPermissionRulesTable } from './tables/guild_dashboard_permission_rules.js';
import { guildDefconExemptionsTable } from './tables/guild_defcon_exemptions.js';
import { webSessionsTable } from './tables/web_sessions.js';
import { fluxerOauthTokensTable } from './tables/fluxer_oauth_tokens.js';
import { botActionEventsTable } from './tables/bot_action_events.js';
import { dashboardLiveStatesTable } from './tables/dashboard_live_states.js';
import { dashboardCatalogStatesTable } from './tables/dashboard_catalog_states.js';

export const coreTables = {
    guilds: guildsTable,
    botInstallations: botInstallationsTable,
    deploymentConfig: deploymentConfigTable,
    guildFeatureSettings: guildFeatureSettingsTable,
    guildSecurityPolicies: guildSecurityPoliciesTable,
    guildCommandPermissionRules: guildCommandPermissionRulesTable,
    guildDashboardPermissionRules: guildDashboardPermissionRulesTable,
    guildDefconExemptions: guildDefconExemptionsTable,
    webSessions: webSessionsTable,
    fluxerOauthTokens: fluxerOauthTokensTable,
    botActionEvents: botActionEventsTable,
    dashboardLiveStates: dashboardLiveStatesTable,
    dashboardCatalogStates: dashboardCatalogStatesTable,
};
