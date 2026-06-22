CREATE TABLE "deployment_config" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_mode" text NOT NULL,
	"single_guild_id" text,
	"public_web_url" text,
	"owner_ids" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
