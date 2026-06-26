CREATE OR REPLACE FUNCTION public.notify_neonflux_dashboard_audit_events()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.guild_id IS NOT NULL THEN
        PERFORM pg_notify(
            'neonflux_dashboard_events',
            json_build_object(
                'guildId', NEW.guild_id,
                'area', 'audit',
                'event', 'dashboard-audit-events.changed'
            )::text
        );
    END IF;

    RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS bot_action_events_dashboard_events ON public.bot_action_events;--> statement-breakpoint

CREATE TRIGGER bot_action_events_dashboard_events
AFTER INSERT ON public.bot_action_events
FOR EACH ROW
EXECUTE FUNCTION public.notify_neonflux_dashboard_audit_events();
