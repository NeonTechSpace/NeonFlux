CREATE OR REPLACE FUNCTION notify_autorole_dashboard_events()
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
                'area', 'autorole',
                'event', 'autorole-rules.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER autorole_rules_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON autorole_rules
FOR EACH ROW EXECUTE FUNCTION notify_autorole_dashboard_events();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_access_dashboard_events()
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
                'area', 'access',
                'event', 'access-rules.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER guild_command_permission_rules_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON guild_command_permission_rules
FOR EACH ROW EXECUTE FUNCTION notify_access_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER guild_dashboard_permission_rules_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON guild_dashboard_permission_rules
FOR EACH ROW EXECUTE FUNCTION notify_access_dashboard_events();
