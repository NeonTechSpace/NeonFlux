CREATE TABLE "vc_generator_control_panels" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "guild_id" text NOT NULL,
    "rule_id" uuid NOT NULL,
    "channel_id" text NOT NULL,
    "message_id" text,
    "control_mode" text DEFAULT 'reaction' NOT NULL,
    "status" text DEFAULT 'active' NOT NULL,
    "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_synced_at" timestamp with time zone,
    "stale_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vc_generator_control_panels" ADD CONSTRAINT "vc_generator_control_panels_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vc_generator_control_panels" ADD CONSTRAINT "vc_generator_control_panels_rule_id_vc_generator_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."vc_generator_rules"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "vc_generator_control_panels_guild_rule_idx" ON "vc_generator_control_panels" USING btree ("guild_id","rule_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "vc_generator_control_panels_guild_message_idx" ON "vc_generator_control_panels" USING btree ("guild_id","message_id");
--> statement-breakpoint
CREATE INDEX "vc_generator_control_panels_guild_status_idx" ON "vc_generator_control_panels" USING btree ("guild_id","status");
--> statement-breakpoint
CREATE INDEX "generated_voice_channels_guild_rule_status_idx" ON "generated_voice_channels" USING btree ("guild_id","rule_id","status");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_vc_generator_dashboard_events()
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
                'area', 'vc_generator',
                'event', 'vc-generator.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER vc_generator_rules_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON vc_generator_rules
FOR EACH ROW EXECUTE FUNCTION notify_vc_generator_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER vc_generator_control_panels_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON vc_generator_control_panels
FOR EACH ROW EXECUTE FUNCTION notify_vc_generator_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER generated_voice_channels_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON generated_voice_channels
FOR EACH ROW EXECUTE FUNCTION notify_vc_generator_dashboard_events();
