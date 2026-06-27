CREATE OR REPLACE FUNCTION notify_profile_builder_dashboard_events()
RETURNS trigger AS $$
DECLARE
    affected_guild_id text;
    affected_form_id uuid;
    affected_submission_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'profile_fields' THEN
        affected_form_id := COALESCE(NEW.form_id, OLD.form_id);

        SELECT guild_id
        INTO affected_guild_id
        FROM profile_forms
        WHERE id = affected_form_id;
    ELSIF TG_TABLE_NAME = 'profile_submission_reviews' THEN
        affected_submission_id := COALESCE(NEW.submission_id, OLD.submission_id);

        SELECT guild_id
        INTO affected_guild_id
        FROM profile_submissions
        WHERE id = affected_submission_id;
    ELSE
        affected_guild_id := COALESCE(NEW.guild_id, OLD.guild_id);
    END IF;

    IF affected_guild_id IS NOT NULL THEN
        PERFORM pg_notify(
            'neonflux_dashboard_events',
            json_build_object(
                'guildId', affected_guild_id,
                'area', 'profile_builder',
                'event', 'profile-builder.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER profile_forms_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON profile_forms
FOR EACH ROW EXECUTE FUNCTION notify_profile_builder_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER profile_fields_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON profile_fields
FOR EACH ROW EXECUTE FUNCTION notify_profile_builder_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER profile_submissions_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON profile_submissions
FOR EACH ROW EXECUTE FUNCTION notify_profile_builder_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER profile_submission_reviews_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON profile_submission_reviews
FOR EACH ROW EXECUTE FUNCTION notify_profile_builder_dashboard_events();
