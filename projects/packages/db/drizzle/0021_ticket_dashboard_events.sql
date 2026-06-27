CREATE INDEX "ticket_panels_guild_message_idx" ON "ticket_panels" USING btree ("guild_id","message_id");
--> statement-breakpoint
CREATE INDEX "tickets_guild_channel_idx" ON "tickets" USING btree ("guild_id","channel_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_tickets_dashboard_events()
RETURNS trigger AS $$
DECLARE
    affected_guild_id text;
    affected_ticket_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'ticket_members' OR TG_TABLE_NAME = 'ticket_events' THEN
        affected_ticket_id := COALESCE(NEW.ticket_id, OLD.ticket_id);

        SELECT guild_id
        INTO affected_guild_id
        FROM tickets
        WHERE id = affected_ticket_id;
    ELSE
        affected_guild_id := COALESCE(NEW.guild_id, OLD.guild_id);
    END IF;

    IF affected_guild_id IS NOT NULL THEN
        PERFORM pg_notify(
            'neonflux_dashboard_events',
            json_build_object(
                'guildId', affected_guild_id,
                'area', 'tickets',
                'event', 'tickets.changed'
            )::text
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ticket_panels_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON ticket_panels
FOR EACH ROW EXECUTE FUNCTION notify_tickets_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER tickets_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON tickets
FOR EACH ROW EXECUTE FUNCTION notify_tickets_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER ticket_members_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON ticket_members
FOR EACH ROW EXECUTE FUNCTION notify_tickets_dashboard_events();
--> statement-breakpoint
CREATE TRIGGER ticket_events_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON ticket_events
FOR EACH ROW EXECUTE FUNCTION notify_tickets_dashboard_events();
