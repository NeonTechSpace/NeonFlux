CREATE TYPE "public"."instance_mode" AS ENUM('single', 'multi');--> statement-breakpoint
CREATE TYPE "public"."log_severity" AS ENUM('debug', 'info', 'warn', 'error');--> statement-breakpoint
CREATE TABLE "bot_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"guild_id" text,
	"channel_id" text,
	"user_id" text,
	"severity" "log_severity" DEFAULT 'info' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_installations" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"mode" "instance_mode" DEFAULT 'multi' NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"feature" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feature_settings" ADD CONSTRAINT "feature_settings_guild_id_bot_installations_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."bot_installations"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_events_guild_created_at_idx" ON "bot_events" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_events_event_name_idx" ON "bot_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "bot_installations_mode_idx" ON "bot_installations" USING btree ("mode");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_settings_guild_feature_idx" ON "feature_settings" USING btree ("guild_id","feature");--> statement-breakpoint
CREATE INDEX "feature_settings_guild_idx" ON "feature_settings" USING btree ("guild_id");