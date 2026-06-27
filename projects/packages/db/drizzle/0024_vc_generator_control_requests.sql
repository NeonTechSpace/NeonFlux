CREATE TABLE "vc_generator_control_requests" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "guild_id" text NOT NULL,
    "generated_channel_id" uuid NOT NULL,
    "panel_channel_id" text NOT NULL,
    "target_channel_id" text NOT NULL,
    "requester_user_id" text NOT NULL,
    "control_action" text NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "prompt_message_id" text,
    "value" text,
    "error_message" text,
    "expires_at" timestamp with time zone NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vc_generator_control_requests" ADD CONSTRAINT "vc_generator_control_requests_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vc_generator_control_requests" ADD CONSTRAINT "vc_generator_control_requests_generated_channel_id_generated_voice_channels_id_fk" FOREIGN KEY ("generated_channel_id") REFERENCES "public"."generated_voice_channels"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "vc_generator_control_requests_guild_panel_requester_idx" ON "vc_generator_control_requests" USING btree ("guild_id","panel_channel_id","requester_user_id","status");
--> statement-breakpoint
CREATE INDEX "vc_generator_control_requests_generated_status_idx" ON "vc_generator_control_requests" USING btree ("generated_channel_id","status");
--> statement-breakpoint
CREATE INDEX "vc_generator_control_requests_status_expires_idx" ON "vc_generator_control_requests" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE TRIGGER vc_generator_control_requests_dashboard_notify
AFTER INSERT OR UPDATE OR DELETE ON vc_generator_control_requests
FOR EACH ROW EXECUTE FUNCTION notify_vc_generator_dashboard_events();
