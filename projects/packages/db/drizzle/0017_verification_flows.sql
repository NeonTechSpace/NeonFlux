CREATE TABLE "verification_flows" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "guild_id" text NOT NULL,
    "channel_id" text NOT NULL,
    "message_id" text NOT NULL,
    "emoji_key" text NOT NULL,
    "verified_role_id" text NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verification_flows" ADD CONSTRAINT "verification_flows_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "verification_flows_guild_message_idx" ON "verification_flows" USING btree ("guild_id","message_id");
--> statement-breakpoint
CREATE INDEX "verification_flows_guild_enabled_idx" ON "verification_flows" USING btree ("guild_id","enabled");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_verification_dashboard_events()
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
                'area', 'verification',
                'event', 'verification-flows.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER verification_flows_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON verification_flows
FOR EACH ROW EXECUTE FUNCTION notify_verification_dashboard_events();
