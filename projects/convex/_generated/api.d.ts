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
import type * as blueprint from "../blueprint.js";
import type * as blueprint_blueprint from "../blueprint/blueprint.js";
import type * as blueprint_blueprint_artifact_persistence from "../blueprint/blueprint_artifact_persistence.js";
import type * as blueprint_blueprint_audit from "../blueprint/blueprint_audit.js";
import type * as blueprint_blueprint_backup_access from "../blueprint/blueprint_backup_access.js";
import type * as blueprint_blueprint_backup_contract from "../blueprint/blueprint_backup_contract.js";
import type * as blueprint_blueprint_backup_manual from "../blueprint/blueprint_backup_manual.js";
import type * as blueprint_blueprint_backup_reads from "../blueprint/blueprint_backup_reads.js";
import type * as blueprint_blueprint_backup_scheduled from "../blueprint/blueprint_backup_scheduled.js";
import type * as blueprint_blueprint_contract_validators from "../blueprint/blueprint_contract_validators.js";
import type * as blueprint_blueprint_history_summaries from "../blueprint/blueprint_history_summaries.js";
import type * as blueprint_blueprint_hot_records from "../blueprint/blueprint_hot_records.js";
import type * as blueprint_blueprint_plan_draft from "../blueprint/blueprint_plan_draft.js";
import type * as blueprint_blueprint_plan_finalization from "../blueprint/blueprint_plan_finalization.js";
import type * as blueprint_blueprint_plan_integrity from "../blueprint/blueprint_plan_integrity.js";
import type * as blueprint_blueprint_plan_ledger from "../blueprint/blueprint_plan_ledger.js";
import type * as blueprint_blueprint_plan_persistence from "../blueprint/blueprint_plan_persistence.js";
import type * as blueprint_blueprint_plan_persistence_values from "../blueprint/blueprint_plan_persistence_values.js";
import type * as blueprint_blueprint_plan_review from "../blueprint/blueprint_plan_review.js";
import type * as blueprint_blueprint_run from "../blueprint/blueprint_run.js";
import type * as blueprint_blueprint_run_authorization from "../blueprint/blueprint_run_authorization.js";
import type * as blueprint_blueprint_run_checkpoint from "../blueprint/blueprint_run_checkpoint.js";
import type * as blueprint_blueprint_run_claim from "../blueprint/blueprint_run_claim.js";
import type * as blueprint_blueprint_run_control from "../blueprint/blueprint_run_control.js";
import type * as blueprint_blueprint_run_finalization from "../blueprint/blueprint_run_finalization.js";
import type * as blueprint_blueprint_run_lease from "../blueprint/blueprint_run_lease.js";
import type * as blueprint_blueprint_run_model from "../blueprint/blueprint_run_model.js";
import type * as blueprint_blueprint_run_persistence from "../blueprint/blueprint_run_persistence.js";
import type * as blueprint_blueprint_run_progress from "../blueprint/blueprint_run_progress.js";
import type * as blueprint_blueprint_run_protocol from "../blueprint/blueprint_run_protocol.js";
import type * as blueprint_blueprint_run_restore from "../blueprint/blueprint_run_restore.js";
import type * as blueprint_blueprint_run_step_attempts from "../blueprint/blueprint_run_step_attempts.js";
import type * as blueprint_blueprint_run_step_completion from "../blueprint/blueprint_run_step_completion.js";
import type * as blueprint_blueprint_run_terminal from "../blueprint/blueprint_run_terminal.js";
import type * as blueprint_blueprint_run_terminal_mutation from "../blueprint/blueprint_run_terminal_mutation.js";
import type * as blueprint_blueprint_workflow from "../blueprint/blueprint_workflow.js";
import type * as blueprint_structure_backup_model from "../blueprint/structure_backup_model.js";
import type * as core from "../core.js";
import type * as core_core from "../core/core.js";
import type * as core_core_model from "../core/core_model.js";
import type * as core_dashboard_catalog from "../core/dashboard_catalog.js";
import type * as core_dashboard_live from "../core/dashboard_live.js";
import type * as core_dashboard_live_model from "../core/dashboard_live_model.js";
import type * as core_events from "../core/events.js";
import type * as core_events_model from "../core/events_model.js";
import type * as core_feature_settings from "../core/feature_settings.js";
import type * as core_feature_settings_model from "../core/feature_settings_model.js";
import type * as core_security_policies from "../core/security_policies.js";
import type * as core_security_policies_model from "../core/security_policies_model.js";
import type * as crons from "../crons.js";
import type * as dashboard_catalog from "../dashboard_catalog.js";
import type * as dashboard_live from "../dashboard_live.js";
import type * as events from "../events.js";
import type * as feature_settings from "../feature_settings.js";
import type * as growth_growth_current_state_lifecycle from "../growth/growth_current_state_lifecycle.js";
import type * as growth_growth_daily_aggregate_model from "../growth/growth_daily_aggregate_model.js";
import type * as growth_growth_event_integrity from "../growth/growth_event_integrity.js";
import type * as growth_growth_overview from "../growth/growth_overview.js";
import type * as growth_growth_overview_model from "../growth/growth_overview_model.js";
import type * as growth_growth_retention from "../growth/growth_retention.js";
import type * as growth_overview from "../growth_overview.js";
import type * as posting from "../posting.js";
import type * as posting_message_validators from "../posting/message_validators.js";
import type * as posting_posting from "../posting/posting.js";
import type * as posting_posting_model from "../posting/posting_model.js";
import type * as posting_posting_operation_model from "../posting/posting_operation_model.js";
import type * as posting_posting_operation_worker from "../posting/posting_operation_worker.js";
import type * as posting_posting_operations from "../posting/posting_operations.js";
import type * as retention_historical_retention from "../retention/historical_retention.js";
import type * as retention_retention_policy from "../retention/retention_policy.js";
import type * as runtime from "../runtime.js";
import type * as runtime_contract_model from "../runtime_contract_model.js";
import type * as schema_blueprint from "../schema/blueprint.js";
import type * as schema_core from "../schema/core.js";
import type * as schema_growth from "../schema/growth.js";
import type * as schema_posting from "../schema/posting.js";
import type * as schema_shared from "../schema/shared.js";
import type * as schema_tables_blueprint_plan_approvals from "../schema/tables/blueprint_plan_approvals.js";
import type * as schema_tables_blueprint_plan_authorities from "../schema/tables/blueprint_plan_authorities.js";
import type * as schema_tables_blueprint_plan_authority_chunks from "../schema/tables/blueprint_plan_authority_chunks.js";
import type * as schema_tables_blueprint_plan_decisions from "../schema/tables/blueprint_plan_decisions.js";
import type * as schema_tables_blueprint_plan_execution_authorities from "../schema/tables/blueprint_plan_execution_authorities.js";
import type * as schema_tables_blueprint_plan_execution_authority_buckets from "../schema/tables/blueprint_plan_execution_authority_buckets.js";
import type * as schema_tables_blueprint_plan_preflight_evidence from "../schema/tables/blueprint_plan_preflight_evidence.js";
import type * as schema_tables_blueprint_plan_preflights from "../schema/tables/blueprint_plan_preflights.js";
import type * as schema_tables_blueprint_plan_steps from "../schema/tables/blueprint_plan_steps.js";
import type * as schema_tables_blueprint_plans from "../schema/tables/blueprint_plans.js";
import type * as schema_tables_blueprint_run_cursors from "../schema/tables/blueprint_run_cursors.js";
import type * as schema_tables_blueprint_run_id_mappings from "../schema/tables/blueprint_run_id_mappings.js";
import type * as schema_tables_blueprint_run_observations from "../schema/tables/blueprint_run_observations.js";
import type * as schema_tables_blueprint_run_step_attempts from "../schema/tables/blueprint_run_step_attempts.js";
import type * as schema_tables_blueprint_run_verification_evidence from "../schema/tables/blueprint_run_verification_evidence.js";
import type * as schema_tables_blueprint_runs from "../schema/tables/blueprint_runs.js";
import type * as schema_tables_bot_action_events from "../schema/tables/bot_action_events.js";
import type * as schema_tables_bot_installations from "../schema/tables/bot_installations.js";
import type * as schema_tables_dashboard_catalog_states from "../schema/tables/dashboard_catalog_states.js";
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
import type * as schema_tables_guild_message_activity_receipts from "../schema/tables/guild_message_activity_receipts.js";
import type * as schema_tables_guild_security_policies from "../schema/tables/guild_security_policies.js";
import type * as schema_tables_guilds from "../schema/tables/guilds.js";
import type * as schema_tables_message_templates from "../schema/tables/message_templates.js";
import type * as schema_tables_posted_messages from "../schema/tables/posted_messages.js";
import type * as schema_tables_structure_backup_artifact_chunks from "../schema/tables/structure_backup_artifact_chunks.js";
import type * as schema_tables_structure_backup_settings from "../schema/tables/structure_backup_settings.js";
import type * as schema_tables_structure_backups from "../schema/tables/structure_backups.js";
import type * as schema_tables_web_sessions from "../schema/tables/web_sessions.js";
import type * as security_policies from "../security_policies.js";

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
  blueprint: typeof blueprint;
  "blueprint/blueprint": typeof blueprint_blueprint;
  "blueprint/blueprint_artifact_persistence": typeof blueprint_blueprint_artifact_persistence;
  "blueprint/blueprint_audit": typeof blueprint_blueprint_audit;
  "blueprint/blueprint_backup_access": typeof blueprint_blueprint_backup_access;
  "blueprint/blueprint_backup_contract": typeof blueprint_blueprint_backup_contract;
  "blueprint/blueprint_backup_manual": typeof blueprint_blueprint_backup_manual;
  "blueprint/blueprint_backup_reads": typeof blueprint_blueprint_backup_reads;
  "blueprint/blueprint_backup_scheduled": typeof blueprint_blueprint_backup_scheduled;
  "blueprint/blueprint_contract_validators": typeof blueprint_blueprint_contract_validators;
  "blueprint/blueprint_history_summaries": typeof blueprint_blueprint_history_summaries;
  "blueprint/blueprint_hot_records": typeof blueprint_blueprint_hot_records;
  "blueprint/blueprint_plan_draft": typeof blueprint_blueprint_plan_draft;
  "blueprint/blueprint_plan_finalization": typeof blueprint_blueprint_plan_finalization;
  "blueprint/blueprint_plan_integrity": typeof blueprint_blueprint_plan_integrity;
  "blueprint/blueprint_plan_ledger": typeof blueprint_blueprint_plan_ledger;
  "blueprint/blueprint_plan_persistence": typeof blueprint_blueprint_plan_persistence;
  "blueprint/blueprint_plan_persistence_values": typeof blueprint_blueprint_plan_persistence_values;
  "blueprint/blueprint_plan_review": typeof blueprint_blueprint_plan_review;
  "blueprint/blueprint_run": typeof blueprint_blueprint_run;
  "blueprint/blueprint_run_authorization": typeof blueprint_blueprint_run_authorization;
  "blueprint/blueprint_run_checkpoint": typeof blueprint_blueprint_run_checkpoint;
  "blueprint/blueprint_run_claim": typeof blueprint_blueprint_run_claim;
  "blueprint/blueprint_run_control": typeof blueprint_blueprint_run_control;
  "blueprint/blueprint_run_finalization": typeof blueprint_blueprint_run_finalization;
  "blueprint/blueprint_run_lease": typeof blueprint_blueprint_run_lease;
  "blueprint/blueprint_run_model": typeof blueprint_blueprint_run_model;
  "blueprint/blueprint_run_persistence": typeof blueprint_blueprint_run_persistence;
  "blueprint/blueprint_run_progress": typeof blueprint_blueprint_run_progress;
  "blueprint/blueprint_run_protocol": typeof blueprint_blueprint_run_protocol;
  "blueprint/blueprint_run_restore": typeof blueprint_blueprint_run_restore;
  "blueprint/blueprint_run_step_attempts": typeof blueprint_blueprint_run_step_attempts;
  "blueprint/blueprint_run_step_completion": typeof blueprint_blueprint_run_step_completion;
  "blueprint/blueprint_run_terminal": typeof blueprint_blueprint_run_terminal;
  "blueprint/blueprint_run_terminal_mutation": typeof blueprint_blueprint_run_terminal_mutation;
  "blueprint/blueprint_workflow": typeof blueprint_blueprint_workflow;
  "blueprint/structure_backup_model": typeof blueprint_structure_backup_model;
  core: typeof core;
  "core/core": typeof core_core;
  "core/core_model": typeof core_core_model;
  "core/dashboard_catalog": typeof core_dashboard_catalog;
  "core/dashboard_live": typeof core_dashboard_live;
  "core/dashboard_live_model": typeof core_dashboard_live_model;
  "core/events": typeof core_events;
  "core/events_model": typeof core_events_model;
  "core/feature_settings": typeof core_feature_settings;
  "core/feature_settings_model": typeof core_feature_settings_model;
  "core/security_policies": typeof core_security_policies;
  "core/security_policies_model": typeof core_security_policies_model;
  crons: typeof crons;
  dashboard_catalog: typeof dashboard_catalog;
  dashboard_live: typeof dashboard_live;
  events: typeof events;
  feature_settings: typeof feature_settings;
  "growth/growth_current_state_lifecycle": typeof growth_growth_current_state_lifecycle;
  "growth/growth_daily_aggregate_model": typeof growth_growth_daily_aggregate_model;
  "growth/growth_event_integrity": typeof growth_growth_event_integrity;
  "growth/growth_overview": typeof growth_growth_overview;
  "growth/growth_overview_model": typeof growth_growth_overview_model;
  "growth/growth_retention": typeof growth_growth_retention;
  growth_overview: typeof growth_overview;
  posting: typeof posting;
  "posting/message_validators": typeof posting_message_validators;
  "posting/posting": typeof posting_posting;
  "posting/posting_model": typeof posting_posting_model;
  "posting/posting_operation_model": typeof posting_posting_operation_model;
  "posting/posting_operation_worker": typeof posting_posting_operation_worker;
  "posting/posting_operations": typeof posting_posting_operations;
  "retention/historical_retention": typeof retention_historical_retention;
  "retention/retention_policy": typeof retention_retention_policy;
  runtime: typeof runtime;
  runtime_contract_model: typeof runtime_contract_model;
  "schema/blueprint": typeof schema_blueprint;
  "schema/core": typeof schema_core;
  "schema/growth": typeof schema_growth;
  "schema/posting": typeof schema_posting;
  "schema/shared": typeof schema_shared;
  "schema/tables/blueprint_plan_approvals": typeof schema_tables_blueprint_plan_approvals;
  "schema/tables/blueprint_plan_authorities": typeof schema_tables_blueprint_plan_authorities;
  "schema/tables/blueprint_plan_authority_chunks": typeof schema_tables_blueprint_plan_authority_chunks;
  "schema/tables/blueprint_plan_decisions": typeof schema_tables_blueprint_plan_decisions;
  "schema/tables/blueprint_plan_execution_authorities": typeof schema_tables_blueprint_plan_execution_authorities;
  "schema/tables/blueprint_plan_execution_authority_buckets": typeof schema_tables_blueprint_plan_execution_authority_buckets;
  "schema/tables/blueprint_plan_preflight_evidence": typeof schema_tables_blueprint_plan_preflight_evidence;
  "schema/tables/blueprint_plan_preflights": typeof schema_tables_blueprint_plan_preflights;
  "schema/tables/blueprint_plan_steps": typeof schema_tables_blueprint_plan_steps;
  "schema/tables/blueprint_plans": typeof schema_tables_blueprint_plans;
  "schema/tables/blueprint_run_cursors": typeof schema_tables_blueprint_run_cursors;
  "schema/tables/blueprint_run_id_mappings": typeof schema_tables_blueprint_run_id_mappings;
  "schema/tables/blueprint_run_observations": typeof schema_tables_blueprint_run_observations;
  "schema/tables/blueprint_run_step_attempts": typeof schema_tables_blueprint_run_step_attempts;
  "schema/tables/blueprint_run_verification_evidence": typeof schema_tables_blueprint_run_verification_evidence;
  "schema/tables/blueprint_runs": typeof schema_tables_blueprint_runs;
  "schema/tables/bot_action_events": typeof schema_tables_bot_action_events;
  "schema/tables/bot_installations": typeof schema_tables_bot_installations;
  "schema/tables/dashboard_catalog_states": typeof schema_tables_dashboard_catalog_states;
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
  "schema/tables/guild_message_activity_receipts": typeof schema_tables_guild_message_activity_receipts;
  "schema/tables/guild_security_policies": typeof schema_tables_guild_security_policies;
  "schema/tables/guilds": typeof schema_tables_guilds;
  "schema/tables/message_templates": typeof schema_tables_message_templates;
  "schema/tables/posted_messages": typeof schema_tables_posted_messages;
  "schema/tables/structure_backup_artifact_chunks": typeof schema_tables_structure_backup_artifact_chunks;
  "schema/tables/structure_backup_settings": typeof schema_tables_structure_backup_settings;
  "schema/tables/structure_backups": typeof schema_tables_structure_backups;
  "schema/tables/web_sessions": typeof schema_tables_web_sessions;
  security_policies: typeof security_policies;
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
