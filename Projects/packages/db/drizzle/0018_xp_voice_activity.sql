ALTER TABLE "xp_settings" ADD COLUMN "voice_xp_per_minute" integer DEFAULT 2 NOT NULL;
--> statement-breakpoint
ALTER TABLE "xp_settings" ADD COLUMN "voice_minimum_minutes" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE "guild_user_xp" ADD COLUMN "message_xp" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "guild_user_xp" ADD COLUMN "voice_xp" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "guild_user_xp" ADD COLUMN "voice_seconds" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "guild_user_xp" ADD COLUMN "last_voice_xp_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "guild_user_xp" SET "message_xp" = "xp";
--> statement-breakpoint
CREATE TABLE "xp_grants" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "guild_id" text NOT NULL,
    "user_id" text NOT NULL,
    "source" text NOT NULL,
    "xp" integer NOT NULL,
    "level_before" integer NOT NULL,
    "level_after" integer NOT NULL,
    "idempotency_key" text NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_voice_sessions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "guild_id" text NOT NULL,
    "user_id" text NOT NULL,
    "channel_id" text NOT NULL,
    "status" text DEFAULT 'active' NOT NULL,
    "started_at" timestamp with time zone DEFAULT now() NOT NULL,
    "ended_at" timestamp with time zone,
    "credited_seconds" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "xp_grants" ADD CONSTRAINT "xp_grants_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "xp_voice_sessions" ADD CONSTRAINT "xp_voice_sessions_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "xp_grants_guild_key_idx" ON "xp_grants" USING btree ("guild_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "xp_grants_guild_user_granted_idx" ON "xp_grants" USING btree ("guild_id","user_id","granted_at");
--> statement-breakpoint
CREATE INDEX "xp_grants_guild_source_granted_idx" ON "xp_grants" USING btree ("guild_id","source","granted_at");
--> statement-breakpoint
CREATE INDEX "xp_voice_sessions_guild_user_status_idx" ON "xp_voice_sessions" USING btree ("guild_id","user_id","status");
--> statement-breakpoint
CREATE INDEX "xp_voice_sessions_guild_status_started_idx" ON "xp_voice_sessions" USING btree ("guild_id","status","started_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_xp_dashboard_events()
RETURNS trigger AS $$
DECLARE
    affected_guild_id text;
BEGIN
    affected_guild_id := COALESCE(NEW.guild_id, OLD.guild_id);

    IF affected_guild_id IS NOT NULL THEN
        PERFORM pg_notify(
            'neonflux_dashboard_events',
            json_build_object(
                'guildId', affected_guild_id,
                'area', 'xp',
                'event', 'xp-settings.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER xp_settings_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON xp_settings
FOR EACH ROW EXECUTE FUNCTION notify_xp_dashboard_events();
