CREATE TABLE "guild_logging_destinations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "guild_id" text NOT NULL,
    "event_group" text NOT NULL,
    "channel_id" text NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "guild_logging_destinations_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX "guild_logging_destinations_guild_group_idx" ON "guild_logging_destinations" USING btree ("guild_id","event_group");--> statement-breakpoint
CREATE INDEX "guild_logging_destinations_guild_enabled_idx" ON "guild_logging_destinations" USING btree ("guild_id","enabled");--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notify_neonflux_logging_destination_events()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    changed_row record;
BEGIN
    changed_row := CASE
        WHEN TG_OP = 'DELETE' THEN OLD
        ELSE NEW
    END;

    PERFORM pg_notify(
        'neonflux_dashboard_events',
        json_build_object(
            'guildId', changed_row.guild_id,
            'area', 'logging',
            'event', 'logging-destinations.changed'
        )::text
    );

    RETURN changed_row;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS guild_logging_destinations_dashboard_events ON public.guild_logging_destinations;--> statement-breakpoint
CREATE TRIGGER guild_logging_destinations_dashboard_events
AFTER INSERT OR UPDATE OR DELETE ON public.guild_logging_destinations
FOR EACH ROW
EXECUTE FUNCTION public.notify_neonflux_logging_destination_events();
