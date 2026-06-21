CREATE TABLE "fluxer_oauth_tokens" (
	"fluxer_user_id" text PRIMARY KEY NOT NULL,
	"access_token" jsonb NOT NULL,
	"refresh_token" jsonb,
	"token_type" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"scopes" text[] NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fluxer_oauth_tokens_access_token_expires_at_idx" ON "fluxer_oauth_tokens" USING btree ("access_token_expires_at");--> statement-breakpoint
CREATE INDEX "fluxer_oauth_tokens_invalidated_at_idx" ON "fluxer_oauth_tokens" USING btree ("invalidated_at");