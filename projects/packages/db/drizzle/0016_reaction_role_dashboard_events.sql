CREATE OR REPLACE FUNCTION notify_reaction_role_dashboard_events()
RETURNS trigger AS $$
DECLARE
    affected_guild_id text;
BEGIN
    IF TG_TABLE_NAME = 'reaction_role_messages' THEN
        affected_guild_id := COALESCE(NEW.guild_id, OLD.guild_id);
    ELSE
        SELECT guild_id
        INTO affected_guild_id
        FROM reaction_role_messages
        WHERE id = COALESCE(NEW.reaction_role_message_id, OLD.reaction_role_message_id);
    END IF;

    IF affected_guild_id IS NOT NULL THEN
        PERFORM pg_notify(
            'neonflux_dashboard_events',
            json_build_object(
                'guildId', affected_guild_id,
                'area', 'reaction_roles',
                'event', 'reaction-roles.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER reaction_role_messages_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON reaction_role_messages
FOR EACH ROW EXECUTE FUNCTION notify_reaction_role_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER reaction_role_options_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON reaction_role_options
FOR EACH ROW EXECUTE FUNCTION notify_reaction_role_dashboard_events();
