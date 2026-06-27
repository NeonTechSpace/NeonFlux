CREATE TABLE "giveaways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"title" text NOT NULL,
	"prize" text NOT NULL,
	"description" text,
	"entry_emoji" text DEFAULT '🎉' NOT NULL,
	"winner_count" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by_user_id" text,
	"closed_by_user_id" text,
	"closed_at" timestamp with time zone,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giveaway_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"giveaway_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "giveaway_winners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"giveaway_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"draw_number" integer DEFAULT 1 NOT NULL,
	"selected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giveaway_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"giveaway_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "giveaways" ADD CONSTRAINT "giveaways_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "giveaway_entries" ADD CONSTRAINT "giveaway_entries_giveaway_id_giveaways_id_fk" FOREIGN KEY ("giveaway_id") REFERENCES "public"."giveaways"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "giveaway_winners" ADD CONSTRAINT "giveaway_winners_giveaway_id_giveaways_id_fk" FOREIGN KEY ("giveaway_id") REFERENCES "public"."giveaways"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "giveaway_events" ADD CONSTRAINT "giveaway_events_giveaway_id_giveaways_id_fk" FOREIGN KEY ("giveaway_id") REFERENCES "public"."giveaways"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "giveaways_guild_status_idx" ON "giveaways" USING btree ("guild_id","status");
--> statement-breakpoint
CREATE INDEX "giveaways_guild_message_idx" ON "giveaways" USING btree ("guild_id","message_id");
--> statement-breakpoint
CREATE INDEX "giveaways_ends_at_idx" ON "giveaways" USING btree ("ends_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "giveaway_entries_giveaway_user_idx" ON "giveaway_entries" USING btree ("giveaway_id","user_id");
--> statement-breakpoint
CREATE INDEX "giveaway_entries_giveaway_removed_idx" ON "giveaway_entries" USING btree ("giveaway_id","removed_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "giveaway_winners_giveaway_user_draw_idx" ON "giveaway_winners" USING btree ("giveaway_id","user_id","draw_number");
--> statement-breakpoint
CREATE INDEX "giveaway_winners_giveaway_draw_idx" ON "giveaway_winners" USING btree ("giveaway_id","draw_number");
--> statement-breakpoint
CREATE INDEX "giveaway_events_giveaway_created_idx" ON "giveaway_events" USING btree ("giveaway_id","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_giveaway_dashboard_events()
RETURNS trigger AS $$
DECLARE
    affected_guild_id text;
    affected_giveaway_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'giveaways' THEN
        affected_guild_id := COALESCE(NEW.guild_id, OLD.guild_id);
    ELSE
        IF TG_TABLE_NAME = 'giveaway_entries' THEN
            affected_giveaway_id := COALESCE(NEW.giveaway_id, OLD.giveaway_id);
        ELSIF TG_TABLE_NAME = 'giveaway_winners' THEN
            affected_giveaway_id := COALESCE(NEW.giveaway_id, OLD.giveaway_id);
        ELSE
            affected_giveaway_id := COALESCE(NEW.giveaway_id, OLD.giveaway_id);
        END IF;

        SELECT guild_id
        INTO affected_guild_id
        FROM giveaways
        WHERE id = affected_giveaway_id;
    END IF;

    IF affected_guild_id IS NOT NULL THEN
        PERFORM pg_notify(
            'neonflux_dashboard_events',
            json_build_object(
                'guildId', affected_guild_id,
                'area', 'giveaways',
                'event', 'giveaways.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER giveaways_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON giveaways
FOR EACH ROW EXECUTE FUNCTION notify_giveaway_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER giveaway_entries_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON giveaway_entries
FOR EACH ROW EXECUTE FUNCTION notify_giveaway_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER giveaway_winners_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON giveaway_winners
FOR EACH ROW EXECUTE FUNCTION notify_giveaway_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER giveaway_events_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON giveaway_events
FOR EACH ROW EXECUTE FUNCTION notify_giveaway_dashboard_events();
