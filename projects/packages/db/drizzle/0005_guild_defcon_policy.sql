CREATE TABLE "guild_command_permission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"category" text NOT NULL,
	"user_ids" text[] DEFAULT '{}' NOT NULL,
	"role_ids" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_dashboard_permission_rules" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"user_ids" text[] DEFAULT '{}' NOT NULL,
	"role_ids" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_defcon_exemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_security_policies" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"defcon_level" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_security_policies_defcon_level_check" CHECK ("guild_security_policies"."defcon_level" in (1, 2, 3))
);
--> statement-breakpoint
ALTER TABLE "guild_command_permission_rules" ADD CONSTRAINT "guild_command_permission_rules_guild_id_bot_installations_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."bot_installations"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_dashboard_permission_rules" ADD CONSTRAINT "guild_dashboard_permission_rules_guild_id_bot_installations_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."bot_installations"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_defcon_exemptions" ADD CONSTRAINT "guild_defcon_exemptions_guild_id_bot_installations_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."bot_installations"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_security_policies" ADD CONSTRAINT "guild_security_policies_guild_id_bot_installations_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."bot_installations"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guild_command_permission_rules_guild_category_idx" ON "guild_command_permission_rules" USING btree ("guild_id","category");--> statement-breakpoint
CREATE INDEX "guild_command_permission_rules_guild_idx" ON "guild_command_permission_rules" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guild_defcon_exemptions_guild_category_idx" ON "guild_defcon_exemptions" USING btree ("guild_id","category");--> statement-breakpoint
CREATE INDEX "guild_defcon_exemptions_guild_idx" ON "guild_defcon_exemptions" USING btree ("guild_id");