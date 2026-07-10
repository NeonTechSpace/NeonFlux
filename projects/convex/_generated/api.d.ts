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
import type * as crons from "../crons.js";
import type * as dashboard_live from "../dashboard_live.js";
import type * as events from "../events.js";
import type * as feature_settings from "../feature_settings.js";
import type * as growth_growth_current_state_lifecycle from "../growth/growth_current_state_lifecycle.js";
import type * as growth_growth_daily_aggregate_model from "../growth/growth_daily_aggregate_model.js";
import type * as growth_growth_overview from "../growth/growth_overview.js";
import type * as growth_growth_overview_model from "../growth/growth_overview_model.js";
import type * as growth_growth_retention from "../growth/growth_retention.js";
import type * as growth_overview from "../growth_overview.js";
import type * as posting from "../posting.js";
import type * as posting_posting from "../posting/posting.js";
import type * as posting_posting_model from "../posting/posting_model.js";
import type * as reaction_roles from "../reaction_roles.js";
import type * as roles_reaction_role_assignments from "../roles/reaction_role_assignments.js";
import type * as roles_reaction_role_maintenance from "../roles/reaction_role_maintenance.js";
import type * as roles_reaction_role_member_state_model from "../roles/reaction_role_member_state_model.js";
import type * as roles_reaction_role_member_states from "../roles/reaction_role_member_states.js";
import type * as roles_reaction_role_operation_completion from "../roles/reaction_role_operation_completion.js";
import type * as roles_reaction_role_operation_model from "../roles/reaction_role_operation_model.js";
import type * as roles_reaction_role_operation_requests from "../roles/reaction_role_operation_requests.js";
import type * as roles_reaction_role_operation_worker from "../roles/reaction_role_operation_worker.js";
import type * as roles_reaction_role_scope from "../roles/reaction_role_scope.js";
import type * as roles_reaction_role_user_leases from "../roles/reaction_role_user_leases.js";
import type * as roles_reaction_roles from "../roles/reaction_roles.js";
import type * as roles_reaction_roles_model from "../roles/reaction_roles_model.js";
import type * as roles_reaction_roles_validators from "../roles/reaction_roles_validators.js";
import type * as schema_core from "../schema/core.js";
import type * as schema_growth from "../schema/growth.js";
import type * as schema_posting from "../schema/posting.js";
import type * as schema_roles from "../schema/roles.js";
import type * as schema_shared from "../schema/shared.js";
import type * as schema_structure from "../schema/structure.js";
import type * as schema_tables_bot_action_events from "../schema/tables/bot_action_events.js";
import type * as schema_tables_bot_installations from "../schema/tables/bot_installations.js";
import type * as schema_tables_dashboard_live_states from "../schema/tables/dashboard_live_states.js";
import type * as schema_tables_dashboard_posting_operations from "../schema/tables/dashboard_posting_operations.js";
import type * as schema_tables_deployment_config from "../schema/tables/deployment_config.js";
import type * as schema_tables_fluxer_oauth_tokens from "../schema/tables/fluxer_oauth_tokens.js";
import type * as schema_tables_guild_command_permission_rules from "../schema/tables/guild_command_permission_rules.js";
import type * as schema_tables_guild_dashboard_permission_rules from "../schema/tables/guild_dashboard_permission_rules.js";
import type * as schema_tables_guild_defcon_exemptions from "../schema/tables/guild_defcon_exemptions.js";
import type * as schema_tables_guild_feature_settings from "../schema/tables/guild_feature_settings.js";
import type * as schema_tables_guild_growth_daily_aggregates from "../schema/tables/guild_growth_daily_aggregates.js";
import type * as schema_tables_guild_growth_states from "../schema/tables/guild_growth_states.js";
import type * as schema_tables_guild_invite_snapshots from "../schema/tables/guild_invite_snapshots.js";
import type * as schema_tables_guild_member_flow_events from "../schema/tables/guild_member_flow_events.js";
import type * as schema_tables_guild_message_activity_days from "../schema/tables/guild_message_activity_days.js";
import type * as schema_tables_guild_security_policies from "../schema/tables/guild_security_policies.js";
import type * as schema_tables_guilds from "../schema/tables/guilds.js";
import type * as schema_tables_message_templates from "../schema/tables/message_templates.js";
import type * as schema_tables_posted_messages from "../schema/tables/posted_messages.js";
import type * as schema_tables_reaction_role_assignments from "../schema/tables/reaction_role_assignments.js";
import type * as schema_tables_reaction_role_member_states from "../schema/tables/reaction_role_member_states.js";
import type * as schema_tables_reaction_role_messages from "../schema/tables/reaction_role_messages.js";
import type * as schema_tables_reaction_role_operations from "../schema/tables/reaction_role_operations.js";
import type * as schema_tables_reaction_role_options from "../schema/tables/reaction_role_options.js";
import type * as schema_tables_reaction_role_reconciliation_items from "../schema/tables/reaction_role_reconciliation_items.js";
import type * as schema_tables_reaction_role_user_leases from "../schema/tables/reaction_role_user_leases.js";
import type * as schema_tables_structure_backup_settings from "../schema/tables/structure_backup_settings.js";
import type * as schema_tables_structure_backups from "../schema/tables/structure_backups.js";
import type * as schema_tables_structure_import_actions from "../schema/tables/structure_import_actions.js";
import type * as schema_tables_structure_import_runs from "../schema/tables/structure_import_runs.js";
import type * as schema_tables_web_sessions from "../schema/tables/web_sessions.js";
import type * as security_policies from "../security_policies.js";
import type * as structure from "../structure.js";
import type * as structure_structure from "../structure/structure.js";
import type * as structure_structure_model from "../structure/structure_model.js";

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
  crons: typeof crons;
  dashboard_live: typeof dashboard_live;
  events: typeof events;
  feature_settings: typeof feature_settings;
  "growth/growth_current_state_lifecycle": typeof growth_growth_current_state_lifecycle;
  "growth/growth_daily_aggregate_model": typeof growth_growth_daily_aggregate_model;
  "growth/growth_overview": typeof growth_growth_overview;
  "growth/growth_overview_model": typeof growth_growth_overview_model;
  "growth/growth_retention": typeof growth_growth_retention;
  growth_overview: typeof growth_overview;
  posting: typeof posting;
  "posting/posting": typeof posting_posting;
  "posting/posting_model": typeof posting_posting_model;
  reaction_roles: typeof reaction_roles;
  "roles/reaction_role_assignments": typeof roles_reaction_role_assignments;
  "roles/reaction_role_maintenance": typeof roles_reaction_role_maintenance;
  "roles/reaction_role_member_state_model": typeof roles_reaction_role_member_state_model;
  "roles/reaction_role_member_states": typeof roles_reaction_role_member_states;
  "roles/reaction_role_operation_completion": typeof roles_reaction_role_operation_completion;
  "roles/reaction_role_operation_model": typeof roles_reaction_role_operation_model;
  "roles/reaction_role_operation_requests": typeof roles_reaction_role_operation_requests;
  "roles/reaction_role_operation_worker": typeof roles_reaction_role_operation_worker;
  "roles/reaction_role_scope": typeof roles_reaction_role_scope;
  "roles/reaction_role_user_leases": typeof roles_reaction_role_user_leases;
  "roles/reaction_roles": typeof roles_reaction_roles;
  "roles/reaction_roles_model": typeof roles_reaction_roles_model;
  "roles/reaction_roles_validators": typeof roles_reaction_roles_validators;
  "schema/core": typeof schema_core;
  "schema/growth": typeof schema_growth;
  "schema/posting": typeof schema_posting;
  "schema/roles": typeof schema_roles;
  "schema/shared": typeof schema_shared;
  "schema/structure": typeof schema_structure;
  "schema/tables/bot_action_events": typeof schema_tables_bot_action_events;
  "schema/tables/bot_installations": typeof schema_tables_bot_installations;
  "schema/tables/dashboard_live_states": typeof schema_tables_dashboard_live_states;
  "schema/tables/dashboard_posting_operations": typeof schema_tables_dashboard_posting_operations;
  "schema/tables/deployment_config": typeof schema_tables_deployment_config;
  "schema/tables/fluxer_oauth_tokens": typeof schema_tables_fluxer_oauth_tokens;
  "schema/tables/guild_command_permission_rules": typeof schema_tables_guild_command_permission_rules;
  "schema/tables/guild_dashboard_permission_rules": typeof schema_tables_guild_dashboard_permission_rules;
  "schema/tables/guild_defcon_exemptions": typeof schema_tables_guild_defcon_exemptions;
  "schema/tables/guild_feature_settings": typeof schema_tables_guild_feature_settings;
  "schema/tables/guild_growth_daily_aggregates": typeof schema_tables_guild_growth_daily_aggregates;
  "schema/tables/guild_growth_states": typeof schema_tables_guild_growth_states;
  "schema/tables/guild_invite_snapshots": typeof schema_tables_guild_invite_snapshots;
  "schema/tables/guild_member_flow_events": typeof schema_tables_guild_member_flow_events;
  "schema/tables/guild_message_activity_days": typeof schema_tables_guild_message_activity_days;
  "schema/tables/guild_security_policies": typeof schema_tables_guild_security_policies;
  "schema/tables/guilds": typeof schema_tables_guilds;
  "schema/tables/message_templates": typeof schema_tables_message_templates;
  "schema/tables/posted_messages": typeof schema_tables_posted_messages;
  "schema/tables/reaction_role_assignments": typeof schema_tables_reaction_role_assignments;
  "schema/tables/reaction_role_member_states": typeof schema_tables_reaction_role_member_states;
  "schema/tables/reaction_role_messages": typeof schema_tables_reaction_role_messages;
  "schema/tables/reaction_role_operations": typeof schema_tables_reaction_role_operations;
  "schema/tables/reaction_role_options": typeof schema_tables_reaction_role_options;
  "schema/tables/reaction_role_reconciliation_items": typeof schema_tables_reaction_role_reconciliation_items;
  "schema/tables/reaction_role_user_leases": typeof schema_tables_reaction_role_user_leases;
  "schema/tables/structure_backup_settings": typeof schema_tables_structure_backup_settings;
  "schema/tables/structure_backups": typeof schema_tables_structure_backups;
  "schema/tables/structure_import_actions": typeof schema_tables_structure_import_actions;
  "schema/tables/structure_import_runs": typeof schema_tables_structure_import_runs;
  "schema/tables/web_sessions": typeof schema_tables_web_sessions;
  security_policies: typeof security_policies;
  structure: typeof structure;
  "structure/structure": typeof structure_structure;
  "structure/structure_model": typeof structure_structure_model;
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
