CREATE TABLE "guild_member_flow_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"invite_code" text,
	"inviter_user_id" text,
	"attribution_status" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_invite_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"code" text NOT NULL,
	"inviter_user_id" text,
	"channel_id" text,
	"uses" integer DEFAULT 0 NOT NULL,
	"max_uses" integer,
	"expires_at" timestamp with time zone,
	"temporary" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "guild_message_activity_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"activity_date" text NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_member_flow_events" ADD CONSTRAINT "guild_member_flow_events_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guild_invite_snapshots" ADD CONSTRAINT "guild_invite_snapshots_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guild_message_activity_days" ADD CONSTRAINT "guild_message_activity_days_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "guild_member_flow_events_guild_occurred_idx" ON "guild_member_flow_events" USING btree ("guild_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "guild_member_flow_events_guild_user_idx" ON "guild_member_flow_events" USING btree ("guild_id","user_id");
--> statement-breakpoint
CREATE INDEX "guild_member_flow_events_guild_event_idx" ON "guild_member_flow_events" USING btree ("guild_id","event_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "guild_invite_snapshots_guild_code_idx" ON "guild_invite_snapshots" USING btree ("guild_id","code");
--> statement-breakpoint
CREATE INDEX "guild_invite_snapshots_guild_inviter_idx" ON "guild_invite_snapshots" USING btree ("guild_id","inviter_user_id");
--> statement-breakpoint
CREATE INDEX "guild_invite_snapshots_guild_active_idx" ON "guild_invite_snapshots" USING btree ("guild_id","active");
--> statement-breakpoint
CREATE UNIQUE INDEX "guild_message_activity_days_guild_channel_date_idx" ON "guild_message_activity_days" USING btree ("guild_id","channel_id","activity_date");
--> statement-breakpoint
CREATE INDEX "guild_message_activity_days_guild_date_idx" ON "guild_message_activity_days" USING btree ("guild_id","activity_date");
