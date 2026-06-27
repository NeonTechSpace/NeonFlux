CREATE OR REPLACE FUNCTION notify_suggestions_dashboard_events()
RETURNS trigger AS $$
DECLARE
    affected_guild_id text;
    affected_suggestion_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'suggestion_votes' THEN
        affected_suggestion_id := COALESCE(NEW.suggestion_id, OLD.suggestion_id);

        SELECT guild_id
        INTO affected_guild_id
        FROM suggestions
        WHERE id = affected_suggestion_id;
    ELSE
        affected_guild_id := COALESCE(NEW.guild_id, OLD.guild_id);
    END IF;

    IF affected_guild_id IS NOT NULL THEN
        PERFORM pg_notify(
            'neonflux_dashboard_events',
            json_build_object(
                'guildId', affected_guild_id,
                'area', 'suggestions',
                'event', 'suggestions.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER suggestion_boards_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON suggestion_boards
FOR EACH ROW EXECUTE FUNCTION notify_suggestions_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER suggestions_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON suggestions
FOR EACH ROW EXECUTE FUNCTION notify_suggestions_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER suggestion_votes_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON suggestion_votes
FOR EACH ROW EXECUTE FUNCTION notify_suggestions_dashboard_events();
