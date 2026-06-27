CREATE TABLE "automod_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"trigger_type" text NOT NULL,
	"action_type" text DEFAULT 'record' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automod_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"rule_id" uuid,
	"message_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"action_type" text DEFAULT 'record' NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automod_rules" ADD CONSTRAINT "automod_rules_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automod_events" ADD CONSTRAINT "automod_events_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automod_events" ADD CONSTRAINT "automod_events_rule_id_automod_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automod_rules"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "automod_rules_guild_name_idx" ON "automod_rules" USING btree ("guild_id","name");
--> statement-breakpoint
CREATE INDEX "automod_rules_guild_enabled_idx" ON "automod_rules" USING btree ("guild_id","enabled");
--> statement-breakpoint
CREATE INDEX "automod_rules_guild_trigger_idx" ON "automod_rules" USING btree ("guild_id","trigger_type");
--> statement-breakpoint
CREATE INDEX "automod_events_guild_created_idx" ON "automod_events" USING btree ("guild_id","created_at");
--> statement-breakpoint
CREATE INDEX "automod_events_rule_created_idx" ON "automod_events" USING btree ("rule_id","created_at");
--> statement-breakpoint
CREATE INDEX "automod_events_guild_message_idx" ON "automod_events" USING btree ("guild_id","message_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_automod_dashboard_events()
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
                'area', 'moderation',
                'event', 'automod.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER automod_rules_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON automod_rules
FOR EACH ROW EXECUTE FUNCTION notify_automod_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER automod_events_dashboard_notify
AFTER INSERT OR DELETE ON automod_events
FOR EACH ROW EXECUTE FUNCTION notify_automod_dashboard_events();
