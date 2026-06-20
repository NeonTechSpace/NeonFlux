CREATE TABLE "web_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"fluxer_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "web_sessions_fluxer_user_id_idx" ON "web_sessions" USING btree ("fluxer_user_id");--> statement-breakpoint
CREATE INDEX "web_sessions_expires_at_idx" ON "web_sessions" USING btree ("expires_at");