CREATE OR REPLACE FUNCTION public.notify_neonflux_moderation_case_events()
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
            'area', 'moderation',
            'event', 'moderation-cases.changed'
        )::text
    );

    RETURN changed_row;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS moderation_cases_dashboard_events ON public.moderation_cases;--> statement-breakpoint

CREATE TRIGGER moderation_cases_dashboard_events
AFTER INSERT OR UPDATE OR DELETE ON public.moderation_cases
FOR EACH ROW
EXECUTE FUNCTION public.notify_neonflux_moderation_case_events();
