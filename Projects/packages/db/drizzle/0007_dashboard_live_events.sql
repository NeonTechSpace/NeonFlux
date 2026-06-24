CREATE OR REPLACE FUNCTION public.notify_neonflux_dashboard_events()
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
            'area', changed_row.feature,
            'event', 'guild-feature-settings.changed'
        )::text
    );

    RETURN changed_row;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS guild_feature_settings_dashboard_events ON public.guild_feature_settings;--> statement-breakpoint

CREATE TRIGGER guild_feature_settings_dashboard_events
AFTER INSERT OR UPDATE OR DELETE ON public.guild_feature_settings
FOR EACH ROW
EXECUTE FUNCTION public.notify_neonflux_dashboard_events();
