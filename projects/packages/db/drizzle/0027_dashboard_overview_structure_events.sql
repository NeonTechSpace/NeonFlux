CREATE OR REPLACE FUNCTION notify_overview_dashboard_events()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    affected_guild_id text;
BEGIN
    affected_guild_id := COALESCE(NEW.guild_id, OLD.guild_id);

    IF affected_guild_id IS NOT NULL THEN
        PERFORM pg_notify(
            'neonflux_dashboard_events',
            json_build_object(
                'guildId', affected_guild_id,
                'area', 'overview',
                'event', 'overview.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_invite_tracking_dashboard_events()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    affected_guild_id text;
BEGIN
    affected_guild_id := COALESCE(NEW.guild_id, OLD.guild_id);

    IF affected_guild_id IS NOT NULL THEN
        PERFORM pg_notify(
            'neonflux_dashboard_events',
            json_build_object(
                'guildId', affected_guild_id,
                'area', 'overview',
                'event', 'overview.changed'
            )::text
        );
        PERFORM pg_notify(
            'neonflux_dashboard_events',
            json_build_object(
                'guildId', affected_guild_id,
                'area', 'invites',
                'event', 'invites.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guild_member_flow_events_dashboard_notify ON guild_member_flow_events;
--> statement-breakpoint
CREATE TRIGGER guild_member_flow_events_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON guild_member_flow_events
FOR EACH ROW EXECUTE FUNCTION notify_invite_tracking_dashboard_events();
--> statement-breakpoint
DROP TRIGGER IF EXISTS guild_invite_snapshots_dashboard_notify ON guild_invite_snapshots;
--> statement-breakpoint
CREATE TRIGGER guild_invite_snapshots_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON guild_invite_snapshots
FOR EACH ROW EXECUTE FUNCTION notify_invite_tracking_dashboard_events();
--> statement-breakpoint
DROP TRIGGER IF EXISTS guild_message_activity_days_dashboard_notify ON guild_message_activity_days;
--> statement-breakpoint
CREATE TRIGGER guild_message_activity_days_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON guild_message_activity_days
FOR EACH ROW EXECUTE FUNCTION notify_overview_dashboard_events();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_structure_dashboard_events()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    affected_guild_id text;
BEGIN
    affected_guild_id := COALESCE(NEW.guild_id, OLD.guild_id);

    IF affected_guild_id IS NOT NULL THEN
        PERFORM pg_notify(
            'neonflux_dashboard_events',
            json_build_object(
                'guildId', affected_guild_id,
                'area', 'structure',
                'event', 'structure.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_structure_import_action_dashboard_events()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    affected_run_id uuid;
    affected_guild_id text;
BEGIN
    affected_run_id := COALESCE(NEW.run_id, OLD.run_id);

    SELECT guild_id INTO affected_guild_id
    FROM structure_import_runs
    WHERE id = affected_run_id;

    IF affected_guild_id IS NOT NULL THEN
        PERFORM pg_notify(
            'neonflux_dashboard_events',
            json_build_object(
                'guildId', affected_guild_id,
                'area', 'structure',
                'event', 'structure.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS structure_export_snapshots_dashboard_notify ON structure_export_snapshots;
--> statement-breakpoint
CREATE TRIGGER structure_export_snapshots_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON structure_export_snapshots
FOR EACH ROW EXECUTE FUNCTION notify_structure_dashboard_events();
--> statement-breakpoint
DROP TRIGGER IF EXISTS structure_import_runs_dashboard_notify ON structure_import_runs;
--> statement-breakpoint
CREATE TRIGGER structure_import_runs_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON structure_import_runs
FOR EACH ROW EXECUTE FUNCTION notify_structure_dashboard_events();
--> statement-breakpoint
DROP TRIGGER IF EXISTS structure_import_actions_dashboard_notify ON structure_import_actions;
--> statement-breakpoint
CREATE TRIGGER structure_import_actions_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON structure_import_actions
FOR EACH ROW EXECUTE FUNCTION notify_structure_import_action_dashboard_events();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_posting_dashboard_events()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    affected_guild_id text;
BEGIN
    affected_guild_id := COALESCE(NEW.guild_id, OLD.guild_id);

    IF affected_guild_id IS NOT NULL THEN
        PERFORM pg_notify(
            'neonflux_dashboard_events',
            json_build_object(
                'guildId', affected_guild_id,
                'area', 'posting',
                'event', 'posting-templates.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS message_templates_dashboard_notify ON message_templates;
--> statement-breakpoint
CREATE TRIGGER message_templates_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON message_templates
FOR EACH ROW EXECUTE FUNCTION notify_posting_dashboard_events();
