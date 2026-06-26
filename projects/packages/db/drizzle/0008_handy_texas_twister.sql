CREATE TABLE "guilds" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "guilds" ("guild_id", "first_seen_at", "updated_at")
SELECT
	"guild_id",
	MIN("installed_at"),
	MAX("updated_at")
FROM "bot_installations"
GROUP BY "guild_id"
ON CONFLICT ("guild_id") DO UPDATE SET
	"updated_at" = EXCLUDED."updated_at";--> statement-breakpoint
CREATE TABLE "autorole_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"role_id" text NOT NULL,
	"name" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_action_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text,
	"feature" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"content" text,
	"embeds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_case_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"case_number" integer NOT NULL,
	"action" text NOT NULL,
	"target_user_id" text NOT NULL,
	"actor_user_id" text,
	"reason" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_temporary_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"case_id" uuid,
	"action" text NOT NULL,
	"target_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posted_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"template_id" uuid,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"created_by_user_id" text,
	"purpose" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"max_length" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"approval_required" boolean DEFAULT true NOT NULL,
	"output_channel_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_submission_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"form_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reaction_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"emoji_key" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reaction_role_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"kind" text DEFAULT 'reaction_role' NOT NULL,
	"remove_on_unreact" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"stale_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reaction_role_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reaction_role_message_id" uuid NOT NULL,
	"emoji_key" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggestion_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggestion_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"vote" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"board_id" uuid,
	"channel_id" text,
	"message_id" text,
	"author_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ticket_counters" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"next_ticket_number" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'participant' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_panels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"title" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"panel_id" uuid,
	"ticket_number" integer NOT NULL,
	"channel_id" text,
	"opener_user_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"claimed_by_user_id" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"method" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "generated_voice_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"rule_id" uuid,
	"channel_id" text NOT NULL,
	"owner_user_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_user_xp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_message_xp_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_reconciliation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"role_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structure_export_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"created_by_user_id" text,
	"source" text DEFAULT 'bot' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structure_import_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structure_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"created_by_user_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_snapshot_id" uuid,
	"plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vc_generator_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"source_channel_id" text NOT NULL,
	"category_id" text,
	"name_template" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_role_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"level" integer NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"message_xp_min" integer DEFAULT 5 NOT NULL,
	"message_xp_max" integer DEFAULT 10 NOT NULL,
	"cooldown_seconds" integer DEFAULT 60 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_command_permission_rules" DROP CONSTRAINT "guild_command_permission_rules_guild_id_bot_installations_guild_id_fk";
--> statement-breakpoint
ALTER TABLE "guild_dashboard_permission_rules" DROP CONSTRAINT "guild_dashboard_permission_rules_guild_id_bot_installations_guild_id_fk";
--> statement-breakpoint
ALTER TABLE "guild_defcon_exemptions" DROP CONSTRAINT "guild_defcon_exemptions_guild_id_bot_installations_guild_id_fk";
--> statement-breakpoint
ALTER TABLE "guild_feature_settings" DROP CONSTRAINT "guild_feature_settings_guild_id_bot_installations_guild_id_fk";
--> statement-breakpoint
ALTER TABLE "guild_security_policies" DROP CONSTRAINT "guild_security_policies_guild_id_bot_installations_guild_id_fk";
--> statement-breakpoint
ALTER TABLE "autorole_rules" ADD CONSTRAINT "autorole_rules_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_action_events" ADD CONSTRAINT "bot_action_events_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_case_events" ADD CONSTRAINT "moderation_case_events_case_id_moderation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_temporary_actions" ADD CONSTRAINT "moderation_temporary_actions_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_temporary_actions" ADD CONSTRAINT "moderation_temporary_actions_case_id_moderation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posted_messages" ADD CONSTRAINT "posted_messages_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posted_messages" ADD CONSTRAINT "posted_messages_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_fields" ADD CONSTRAINT "profile_fields_form_id_profile_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."profile_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_forms" ADD CONSTRAINT "profile_forms_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_submission_reviews" ADD CONSTRAINT "profile_submission_reviews_submission_id_profile_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."profile_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_submissions" ADD CONSTRAINT "profile_submissions_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_submissions" ADD CONSTRAINT "profile_submissions_form_id_profile_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."profile_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_role_assignments" ADD CONSTRAINT "reaction_role_assignments_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_role_messages" ADD CONSTRAINT "reaction_role_messages_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_role_options" ADD CONSTRAINT "reaction_role_options_reaction_role_message_id_reaction_role_messages_id_fk" FOREIGN KEY ("reaction_role_message_id") REFERENCES "public"."reaction_role_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_boards" ADD CONSTRAINT "suggestion_boards_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_votes" ADD CONSTRAINT "suggestion_votes_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_board_id_suggestion_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."suggestion_boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_counters" ADD CONSTRAINT "ticket_counters_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_members" ADD CONSTRAINT "ticket_members_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_panels" ADD CONSTRAINT "ticket_panels_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_panel_id_ticket_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."ticket_panels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_voice_channels" ADD CONSTRAINT "generated_voice_channels_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_voice_channels" ADD CONSTRAINT "generated_voice_channels_rule_id_vc_generator_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."vc_generator_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_user_xp" ADD CONSTRAINT "guild_user_xp_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_reconciliation_actions" ADD CONSTRAINT "role_reconciliation_actions_run_id_role_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."role_reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_reconciliation_runs" ADD CONSTRAINT "role_reconciliation_runs_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_export_snapshots" ADD CONSTRAINT "structure_export_snapshots_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_import_actions" ADD CONSTRAINT "structure_import_actions_run_id_structure_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."structure_import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_import_runs" ADD CONSTRAINT "structure_import_runs_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_import_runs" ADD CONSTRAINT "structure_import_runs_source_snapshot_id_structure_export_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."structure_export_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vc_generator_rules" ADD CONSTRAINT "vc_generator_rules_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_role_rewards" ADD CONSTRAINT "xp_role_rewards_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_settings" ADD CONSTRAINT "xp_settings_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autorole_rules_guild_role_idx" ON "autorole_rules" USING btree ("guild_id","role_id");--> statement-breakpoint
CREATE INDEX "autorole_rules_guild_enabled_idx" ON "autorole_rules" USING btree ("guild_id","enabled");--> statement-breakpoint
CREATE INDEX "bot_action_events_guild_created_idx" ON "bot_action_events" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_action_events_feature_created_idx" ON "bot_action_events" USING btree ("feature","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_guild_name_idx" ON "message_templates" USING btree ("guild_id","name");--> statement-breakpoint
CREATE INDEX "moderation_case_events_case_idx" ON "moderation_case_events" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_cases_guild_case_number_idx" ON "moderation_cases" USING btree ("guild_id","case_number");--> statement-breakpoint
CREATE INDEX "moderation_cases_guild_target_idx" ON "moderation_cases" USING btree ("guild_id","target_user_id");--> statement-breakpoint
CREATE INDEX "moderation_cases_guild_status_idx" ON "moderation_cases" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "moderation_temporary_actions_guild_status_idx" ON "moderation_temporary_actions" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "moderation_temporary_actions_status_expires_idx" ON "moderation_temporary_actions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "posted_messages_guild_channel_message_idx" ON "posted_messages" USING btree ("guild_id","channel_id","message_id");--> statement-breakpoint
CREATE INDEX "posted_messages_guild_purpose_idx" ON "posted_messages" USING btree ("guild_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_fields_form_key_idx" ON "profile_fields" USING btree ("form_id","field_key");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_forms_guild_name_idx" ON "profile_forms" USING btree ("guild_id","name");--> statement-breakpoint
CREATE INDEX "profile_submission_reviews_submission_idx" ON "profile_submission_reviews" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "profile_submissions_guild_user_idx" ON "profile_submissions" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "profile_submissions_guild_status_idx" ON "profile_submissions" USING btree ("guild_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_role_assignments_guild_message_user_role_idx" ON "reaction_role_assignments" USING btree ("guild_id","message_id","user_id","role_id");--> statement-breakpoint
CREATE INDEX "reaction_role_assignments_guild_user_idx" ON "reaction_role_assignments" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_role_messages_guild_message_idx" ON "reaction_role_messages" USING btree ("guild_id","message_id");--> statement-breakpoint
CREATE INDEX "reaction_role_messages_guild_enabled_idx" ON "reaction_role_messages" USING btree ("guild_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_role_options_message_emoji_idx" ON "reaction_role_options" USING btree ("reaction_role_message_id","emoji_key");--> statement-breakpoint
CREATE INDEX "reaction_role_options_role_idx" ON "reaction_role_options" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_boards_guild_name_idx" ON "suggestion_boards" USING btree ("guild_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_votes_suggestion_user_idx" ON "suggestion_votes" USING btree ("suggestion_id","user_id");--> statement-breakpoint
CREATE INDEX "suggestions_guild_status_idx" ON "suggestions" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "suggestions_guild_author_idx" ON "suggestions" USING btree ("guild_id","author_user_id");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_created_idx" ON "ticket_events" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_members_ticket_user_idx" ON "ticket_members" USING btree ("ticket_id","user_id");--> statement-breakpoint
CREATE INDEX "ticket_panels_guild_enabled_idx" ON "ticket_panels" USING btree ("guild_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_guild_ticket_number_idx" ON "tickets" USING btree ("guild_id","ticket_number");--> statement-breakpoint
CREATE INDEX "tickets_guild_status_idx" ON "tickets" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "tickets_guild_opener_idx" ON "tickets" USING btree ("guild_id","opener_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_records_guild_user_idx" ON "verification_records" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generated_voice_channels_channel_idx" ON "generated_voice_channels" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "generated_voice_channels_guild_status_idx" ON "generated_voice_channels" USING btree ("guild_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "guild_user_xp_guild_user_idx" ON "guild_user_xp" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "guild_user_xp_guild_level_idx" ON "guild_user_xp" USING btree ("guild_id","level");--> statement-breakpoint
CREATE INDEX "role_reconciliation_actions_run_status_idx" ON "role_reconciliation_actions" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "role_reconciliation_runs_guild_status_idx" ON "role_reconciliation_runs" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "structure_export_snapshots_guild_created_idx" ON "structure_export_snapshots" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "structure_import_actions_run_status_idx" ON "structure_import_actions" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "structure_import_runs_guild_status_idx" ON "structure_import_runs" USING btree ("guild_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "vc_generator_rules_guild_source_idx" ON "vc_generator_rules" USING btree ("guild_id","source_channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_role_rewards_guild_level_role_idx" ON "xp_role_rewards" USING btree ("guild_id","level","role_id");--> statement-breakpoint
ALTER TABLE "bot_installations" ADD CONSTRAINT "bot_installations_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_command_permission_rules" ADD CONSTRAINT "guild_command_permission_rules_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_dashboard_permission_rules" ADD CONSTRAINT "guild_dashboard_permission_rules_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_defcon_exemptions" ADD CONSTRAINT "guild_defcon_exemptions_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_feature_settings" ADD CONSTRAINT "guild_feature_settings_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_security_policies" ADD CONSTRAINT "guild_security_policies_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;
