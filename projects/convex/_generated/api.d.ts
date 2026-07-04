/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access_access_permissions from "../access/access_permissions.js";
import type * as access_access_permissions_model from "../access/access_permissions_model.js";
import type * as access_permissions from "../access_permissions.js";
import type * as auth from "../auth.js";
import type * as auth_auth_store from "../auth/auth_store.js";
import type * as auth_auth_store_model from "../auth/auth_store_model.js";
import type * as auth_store from "../auth_store.js";
import type * as automod from "../automod.js";
import type * as automod_automod from "../automod/automod.js";
import type * as automod_automod_model from "../automod/automod_model.js";
import type * as autoroles from "../autoroles.js";
import type * as community_giveaway_maintenance from "../community/giveaway_maintenance.js";
import type * as community_giveaway_reconciliation from "../community/giveaway_reconciliation.js";
import type * as community_giveaways from "../community/giveaways.js";
import type * as community_giveaways_model from "../community/giveaways_model.js";
import type * as community_profile_builder from "../community/profile_builder.js";
import type * as community_profile_builder_model from "../community/profile_builder_model.js";
import type * as community_suggestions from "../community/suggestions.js";
import type * as community_suggestions_model from "../community/suggestions_model.js";
import type * as core from "../core.js";
import type * as core_core from "../core/core.js";
import type * as core_core_model from "../core/core_model.js";
import type * as core_dashboard_live from "../core/dashboard_live.js";
import type * as core_dashboard_live_model from "../core/dashboard_live_model.js";
import type * as core_events from "../core/events.js";
import type * as core_events_model from "../core/events_model.js";
import type * as core_feature_settings from "../core/feature_settings.js";
import type * as core_feature_settings_model from "../core/feature_settings_model.js";
import type * as core_security_policies from "../core/security_policies.js";
import type * as core_security_policies_model from "../core/security_policies_model.js";
import type * as dashboard_live from "../dashboard_live.js";
import type * as events from "../events.js";
import type * as feature_settings from "../feature_settings.js";
import type * as giveaway_maintenance from "../giveaway_maintenance.js";
import type * as giveaway_reconciliation from "../giveaway_reconciliation.js";
import type * as giveaways from "../giveaways.js";
import type * as growth_growth_overview from "../growth/growth_overview.js";
import type * as growth_growth_overview_model from "../growth/growth_overview_model.js";
import type * as growth_xp from "../growth/xp.js";
import type * as growth_xp_model from "../growth/xp_model.js";
import type * as growth_xp_voice_sessions from "../growth/xp_voice_sessions.js";
import type * as growth_xp_voice_sessions_model from "../growth/xp_voice_sessions_model.js";
import type * as growth_overview from "../growth_overview.js";
import type * as logging_destinations from "../logging_destinations.js";
import type * as moderation from "../moderation.js";
import type * as moderation_moderation from "../moderation/moderation.js";
import type * as moderation_moderation_model from "../moderation/moderation_model.js";
import type * as moderation_moderation_temporary_actions from "../moderation/moderation_temporary_actions.js";
import type * as moderation_temporary_actions from "../moderation_temporary_actions.js";
import type * as posting from "../posting.js";
import type * as posting_posting from "../posting/posting.js";
import type * as posting_posting_model from "../posting/posting_model.js";
import type * as profile_builder from "../profile_builder.js";
import type * as reaction_roles from "../reaction_roles.js";
import type * as role_reconciliation from "../role_reconciliation.js";
import type * as role_reference_cleanup from "../role_reference_cleanup.js";
import type * as roles_autoroles from "../roles/autoroles.js";
import type * as roles_autoroles_model from "../roles/autoroles_model.js";
import type * as roles_logging_destinations from "../roles/logging_destinations.js";
import type * as roles_logging_destinations_model from "../roles/logging_destinations_model.js";
import type * as roles_reaction_roles from "../roles/reaction_roles.js";
import type * as roles_reaction_roles_model from "../roles/reaction_roles_model.js";
import type * as roles_role_reconciliation from "../roles/role_reconciliation.js";
import type * as roles_role_reconciliation_model from "../roles/role_reconciliation_model.js";
import type * as roles_role_reference_cleanup from "../roles/role_reference_cleanup.js";
import type * as roles_role_reference_cleanup_model from "../roles/role_reference_cleanup_model.js";
import type * as roles_verification from "../roles/verification.js";
import type * as roles_verification_model from "../roles/verification_model.js";
import type * as schema_automod from "../schema/automod.js";
import type * as schema_community from "../schema/community.js";
import type * as schema_core from "../schema/core.js";
import type * as schema_growth from "../schema/growth.js";
import type * as schema_moderation from "../schema/moderation.js";
import type * as schema_posting from "../schema/posting.js";
import type * as schema_roles from "../schema/roles.js";
import type * as schema_shared from "../schema/shared.js";
import type * as schema_structure from "../schema/structure.js";
import type * as schema_tables_automod_events from "../schema/tables/automod_events.js";
import type * as schema_tables_automod_rules from "../schema/tables/automod_rules.js";
import type * as schema_tables_autorole_rules from "../schema/tables/autorole_rules.js";
import type * as schema_tables_bot_action_events from "../schema/tables/bot_action_events.js";
import type * as schema_tables_bot_installations from "../schema/tables/bot_installations.js";
import type * as schema_tables_dashboard_live_states from "../schema/tables/dashboard_live_states.js";
import type * as schema_tables_deployment_config from "../schema/tables/deployment_config.js";
import type * as schema_tables_fluxer_oauth_tokens from "../schema/tables/fluxer_oauth_tokens.js";
import type * as schema_tables_generated_voice_channels from "../schema/tables/generated_voice_channels.js";
import type * as schema_tables_giveaway_entries from "../schema/tables/giveaway_entries.js";
import type * as schema_tables_giveaway_events from "../schema/tables/giveaway_events.js";
import type * as schema_tables_giveaway_winners from "../schema/tables/giveaway_winners.js";
import type * as schema_tables_giveaways from "../schema/tables/giveaways.js";
import type * as schema_tables_guild_command_permission_rules from "../schema/tables/guild_command_permission_rules.js";
import type * as schema_tables_guild_dashboard_permission_rules from "../schema/tables/guild_dashboard_permission_rules.js";
import type * as schema_tables_guild_defcon_exemptions from "../schema/tables/guild_defcon_exemptions.js";
import type * as schema_tables_guild_feature_settings from "../schema/tables/guild_feature_settings.js";
import type * as schema_tables_guild_invite_snapshots from "../schema/tables/guild_invite_snapshots.js";
import type * as schema_tables_guild_logging_destinations from "../schema/tables/guild_logging_destinations.js";
import type * as schema_tables_guild_member_flow_events from "../schema/tables/guild_member_flow_events.js";
import type * as schema_tables_guild_message_activity_days from "../schema/tables/guild_message_activity_days.js";
import type * as schema_tables_guild_security_policies from "../schema/tables/guild_security_policies.js";
import type * as schema_tables_guild_user_xp from "../schema/tables/guild_user_xp.js";
import type * as schema_tables_guilds from "../schema/tables/guilds.js";
import type * as schema_tables_message_templates from "../schema/tables/message_templates.js";
import type * as schema_tables_moderation_case_counters from "../schema/tables/moderation_case_counters.js";
import type * as schema_tables_moderation_case_events from "../schema/tables/moderation_case_events.js";
import type * as schema_tables_moderation_cases from "../schema/tables/moderation_cases.js";
import type * as schema_tables_moderation_temporary_actions from "../schema/tables/moderation_temporary_actions.js";
import type * as schema_tables_posted_messages from "../schema/tables/posted_messages.js";
import type * as schema_tables_profile_fields from "../schema/tables/profile_fields.js";
import type * as schema_tables_profile_forms from "../schema/tables/profile_forms.js";
import type * as schema_tables_profile_submission_reviews from "../schema/tables/profile_submission_reviews.js";
import type * as schema_tables_profile_submissions from "../schema/tables/profile_submissions.js";
import type * as schema_tables_reaction_role_assignments from "../schema/tables/reaction_role_assignments.js";
import type * as schema_tables_reaction_role_messages from "../schema/tables/reaction_role_messages.js";
import type * as schema_tables_reaction_role_options from "../schema/tables/reaction_role_options.js";
import type * as schema_tables_role_reconciliation_actions from "../schema/tables/role_reconciliation_actions.js";
import type * as schema_tables_role_reconciliation_runs from "../schema/tables/role_reconciliation_runs.js";
import type * as schema_tables_structure_export_snapshots from "../schema/tables/structure_export_snapshots.js";
import type * as schema_tables_structure_import_actions from "../schema/tables/structure_import_actions.js";
import type * as schema_tables_structure_import_runs from "../schema/tables/structure_import_runs.js";
import type * as schema_tables_suggestion_boards from "../schema/tables/suggestion_boards.js";
import type * as schema_tables_suggestion_votes from "../schema/tables/suggestion_votes.js";
import type * as schema_tables_suggestions from "../schema/tables/suggestions.js";
import type * as schema_tables_ticket_counters from "../schema/tables/ticket_counters.js";
import type * as schema_tables_ticket_events from "../schema/tables/ticket_events.js";
import type * as schema_tables_ticket_members from "../schema/tables/ticket_members.js";
import type * as schema_tables_ticket_panels from "../schema/tables/ticket_panels.js";
import type * as schema_tables_tickets from "../schema/tables/tickets.js";
import type * as schema_tables_vc_generator_control_panels from "../schema/tables/vc_generator_control_panels.js";
import type * as schema_tables_vc_generator_control_requests from "../schema/tables/vc_generator_control_requests.js";
import type * as schema_tables_vc_generator_rules from "../schema/tables/vc_generator_rules.js";
import type * as schema_tables_verification_flows from "../schema/tables/verification_flows.js";
import type * as schema_tables_verification_records from "../schema/tables/verification_records.js";
import type * as schema_tables_web_sessions from "../schema/tables/web_sessions.js";
import type * as schema_tables_xp_grants from "../schema/tables/xp_grants.js";
import type * as schema_tables_xp_role_rewards from "../schema/tables/xp_role_rewards.js";
import type * as schema_tables_xp_settings from "../schema/tables/xp_settings.js";
import type * as schema_tables_xp_voice_sessions from "../schema/tables/xp_voice_sessions.js";
import type * as schema_tickets from "../schema/tickets.js";
import type * as schema_vc_generator from "../schema/vc_generator.js";
import type * as security_policies from "../security_policies.js";
import type * as structure from "../structure.js";
import type * as structure_structure from "../structure/structure.js";
import type * as structure_structure_model from "../structure/structure_model.js";
import type * as suggestions from "../suggestions.js";
import type * as support_tickets from "../support/tickets.js";
import type * as support_tickets_model from "../support/tickets_model.js";
import type * as support_vc_generator from "../support/vc_generator.js";
import type * as support_vc_generator_control_requests from "../support/vc_generator_control_requests.js";
import type * as support_vc_generator_model from "../support/vc_generator_model.js";
import type * as tickets from "../tickets.js";
import type * as vc_generator from "../vc_generator.js";
import type * as vc_generator_control_requests from "../vc_generator_control_requests.js";
import type * as verification from "../verification.js";
import type * as xp from "../xp.js";
import type * as xp_voice_sessions from "../xp_voice_sessions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "access/access_permissions": typeof access_access_permissions;
  "access/access_permissions_model": typeof access_access_permissions_model;
  access_permissions: typeof access_permissions;
  auth: typeof auth;
  "auth/auth_store": typeof auth_auth_store;
  "auth/auth_store_model": typeof auth_auth_store_model;
  auth_store: typeof auth_store;
  automod: typeof automod;
  "automod/automod": typeof automod_automod;
  "automod/automod_model": typeof automod_automod_model;
  autoroles: typeof autoroles;
  "community/giveaway_maintenance": typeof community_giveaway_maintenance;
  "community/giveaway_reconciliation": typeof community_giveaway_reconciliation;
  "community/giveaways": typeof community_giveaways;
  "community/giveaways_model": typeof community_giveaways_model;
  "community/profile_builder": typeof community_profile_builder;
  "community/profile_builder_model": typeof community_profile_builder_model;
  "community/suggestions": typeof community_suggestions;
  "community/suggestions_model": typeof community_suggestions_model;
  core: typeof core;
  "core/core": typeof core_core;
  "core/core_model": typeof core_core_model;
  "core/dashboard_live": typeof core_dashboard_live;
  "core/dashboard_live_model": typeof core_dashboard_live_model;
  "core/events": typeof core_events;
  "core/events_model": typeof core_events_model;
  "core/feature_settings": typeof core_feature_settings;
  "core/feature_settings_model": typeof core_feature_settings_model;
  "core/security_policies": typeof core_security_policies;
  "core/security_policies_model": typeof core_security_policies_model;
  dashboard_live: typeof dashboard_live;
  events: typeof events;
  feature_settings: typeof feature_settings;
  giveaway_maintenance: typeof giveaway_maintenance;
  giveaway_reconciliation: typeof giveaway_reconciliation;
  giveaways: typeof giveaways;
  "growth/growth_overview": typeof growth_growth_overview;
  "growth/growth_overview_model": typeof growth_growth_overview_model;
  "growth/xp": typeof growth_xp;
  "growth/xp_model": typeof growth_xp_model;
  "growth/xp_voice_sessions": typeof growth_xp_voice_sessions;
  "growth/xp_voice_sessions_model": typeof growth_xp_voice_sessions_model;
  growth_overview: typeof growth_overview;
  logging_destinations: typeof logging_destinations;
  moderation: typeof moderation;
  "moderation/moderation": typeof moderation_moderation;
  "moderation/moderation_model": typeof moderation_moderation_model;
  "moderation/moderation_temporary_actions": typeof moderation_moderation_temporary_actions;
  moderation_temporary_actions: typeof moderation_temporary_actions;
  posting: typeof posting;
  "posting/posting": typeof posting_posting;
  "posting/posting_model": typeof posting_posting_model;
  profile_builder: typeof profile_builder;
  reaction_roles: typeof reaction_roles;
  role_reconciliation: typeof role_reconciliation;
  role_reference_cleanup: typeof role_reference_cleanup;
  "roles/autoroles": typeof roles_autoroles;
  "roles/autoroles_model": typeof roles_autoroles_model;
  "roles/logging_destinations": typeof roles_logging_destinations;
  "roles/logging_destinations_model": typeof roles_logging_destinations_model;
  "roles/reaction_roles": typeof roles_reaction_roles;
  "roles/reaction_roles_model": typeof roles_reaction_roles_model;
  "roles/role_reconciliation": typeof roles_role_reconciliation;
  "roles/role_reconciliation_model": typeof roles_role_reconciliation_model;
  "roles/role_reference_cleanup": typeof roles_role_reference_cleanup;
  "roles/role_reference_cleanup_model": typeof roles_role_reference_cleanup_model;
  "roles/verification": typeof roles_verification;
  "roles/verification_model": typeof roles_verification_model;
  "schema/automod": typeof schema_automod;
  "schema/community": typeof schema_community;
  "schema/core": typeof schema_core;
  "schema/growth": typeof schema_growth;
  "schema/moderation": typeof schema_moderation;
  "schema/posting": typeof schema_posting;
  "schema/roles": typeof schema_roles;
  "schema/shared": typeof schema_shared;
  "schema/structure": typeof schema_structure;
  "schema/tables/automod_events": typeof schema_tables_automod_events;
  "schema/tables/automod_rules": typeof schema_tables_automod_rules;
  "schema/tables/autorole_rules": typeof schema_tables_autorole_rules;
  "schema/tables/bot_action_events": typeof schema_tables_bot_action_events;
  "schema/tables/bot_installations": typeof schema_tables_bot_installations;
  "schema/tables/dashboard_live_states": typeof schema_tables_dashboard_live_states;
  "schema/tables/deployment_config": typeof schema_tables_deployment_config;
  "schema/tables/fluxer_oauth_tokens": typeof schema_tables_fluxer_oauth_tokens;
  "schema/tables/generated_voice_channels": typeof schema_tables_generated_voice_channels;
  "schema/tables/giveaway_entries": typeof schema_tables_giveaway_entries;
  "schema/tables/giveaway_events": typeof schema_tables_giveaway_events;
  "schema/tables/giveaway_winners": typeof schema_tables_giveaway_winners;
  "schema/tables/giveaways": typeof schema_tables_giveaways;
  "schema/tables/guild_command_permission_rules": typeof schema_tables_guild_command_permission_rules;
  "schema/tables/guild_dashboard_permission_rules": typeof schema_tables_guild_dashboard_permission_rules;
  "schema/tables/guild_defcon_exemptions": typeof schema_tables_guild_defcon_exemptions;
  "schema/tables/guild_feature_settings": typeof schema_tables_guild_feature_settings;
  "schema/tables/guild_invite_snapshots": typeof schema_tables_guild_invite_snapshots;
  "schema/tables/guild_logging_destinations": typeof schema_tables_guild_logging_destinations;
  "schema/tables/guild_member_flow_events": typeof schema_tables_guild_member_flow_events;
  "schema/tables/guild_message_activity_days": typeof schema_tables_guild_message_activity_days;
  "schema/tables/guild_security_policies": typeof schema_tables_guild_security_policies;
  "schema/tables/guild_user_xp": typeof schema_tables_guild_user_xp;
  "schema/tables/guilds": typeof schema_tables_guilds;
  "schema/tables/message_templates": typeof schema_tables_message_templates;
  "schema/tables/moderation_case_counters": typeof schema_tables_moderation_case_counters;
  "schema/tables/moderation_case_events": typeof schema_tables_moderation_case_events;
  "schema/tables/moderation_cases": typeof schema_tables_moderation_cases;
  "schema/tables/moderation_temporary_actions": typeof schema_tables_moderation_temporary_actions;
  "schema/tables/posted_messages": typeof schema_tables_posted_messages;
  "schema/tables/profile_fields": typeof schema_tables_profile_fields;
  "schema/tables/profile_forms": typeof schema_tables_profile_forms;
  "schema/tables/profile_submission_reviews": typeof schema_tables_profile_submission_reviews;
  "schema/tables/profile_submissions": typeof schema_tables_profile_submissions;
  "schema/tables/reaction_role_assignments": typeof schema_tables_reaction_role_assignments;
  "schema/tables/reaction_role_messages": typeof schema_tables_reaction_role_messages;
  "schema/tables/reaction_role_options": typeof schema_tables_reaction_role_options;
  "schema/tables/role_reconciliation_actions": typeof schema_tables_role_reconciliation_actions;
  "schema/tables/role_reconciliation_runs": typeof schema_tables_role_reconciliation_runs;
  "schema/tables/structure_export_snapshots": typeof schema_tables_structure_export_snapshots;
  "schema/tables/structure_import_actions": typeof schema_tables_structure_import_actions;
  "schema/tables/structure_import_runs": typeof schema_tables_structure_import_runs;
  "schema/tables/suggestion_boards": typeof schema_tables_suggestion_boards;
  "schema/tables/suggestion_votes": typeof schema_tables_suggestion_votes;
  "schema/tables/suggestions": typeof schema_tables_suggestions;
  "schema/tables/ticket_counters": typeof schema_tables_ticket_counters;
  "schema/tables/ticket_events": typeof schema_tables_ticket_events;
  "schema/tables/ticket_members": typeof schema_tables_ticket_members;
  "schema/tables/ticket_panels": typeof schema_tables_ticket_panels;
  "schema/tables/tickets": typeof schema_tables_tickets;
  "schema/tables/vc_generator_control_panels": typeof schema_tables_vc_generator_control_panels;
  "schema/tables/vc_generator_control_requests": typeof schema_tables_vc_generator_control_requests;
  "schema/tables/vc_generator_rules": typeof schema_tables_vc_generator_rules;
  "schema/tables/verification_flows": typeof schema_tables_verification_flows;
  "schema/tables/verification_records": typeof schema_tables_verification_records;
  "schema/tables/web_sessions": typeof schema_tables_web_sessions;
  "schema/tables/xp_grants": typeof schema_tables_xp_grants;
  "schema/tables/xp_role_rewards": typeof schema_tables_xp_role_rewards;
  "schema/tables/xp_settings": typeof schema_tables_xp_settings;
  "schema/tables/xp_voice_sessions": typeof schema_tables_xp_voice_sessions;
  "schema/tickets": typeof schema_tickets;
  "schema/vc_generator": typeof schema_vc_generator;
  security_policies: typeof security_policies;
  structure: typeof structure;
  "structure/structure": typeof structure_structure;
  "structure/structure_model": typeof structure_structure_model;
  suggestions: typeof suggestions;
  "support/tickets": typeof support_tickets;
  "support/tickets_model": typeof support_tickets_model;
  "support/vc_generator": typeof support_vc_generator;
  "support/vc_generator_control_requests": typeof support_vc_generator_control_requests;
  "support/vc_generator_model": typeof support_vc_generator_model;
  tickets: typeof tickets;
  vc_generator: typeof vc_generator;
  vc_generator_control_requests: typeof vc_generator_control_requests;
  verification: typeof verification;
  xp: typeof xp;
  xp_voice_sessions: typeof xp_voice_sessions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
