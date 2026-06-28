ALTER TABLE "reaction_role_messages" ADD COLUMN "mode" text DEFAULT 'normal' NOT NULL;
--> statement-breakpoint
ALTER TABLE "reaction_role_messages" ADD COLUMN "source" text DEFAULT 'existing' NOT NULL;
--> statement-breakpoint
ALTER TABLE "reaction_role_messages" ADD COLUMN "message_content" text;
--> statement-breakpoint
ALTER TABLE "reaction_role_messages" ADD COLUMN "message_embeds" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "reaction_role_messages" ADD COLUMN "generate_overview" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "reaction_role_options" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "reaction_role_messages" DROP COLUMN "remove_on_unreact";
