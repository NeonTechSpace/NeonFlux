ALTER TABLE "moderation_cases" ADD COLUMN "target_type" text;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD COLUMN "target_channel_id" text;--> statement-breakpoint
UPDATE "moderation_cases" SET "target_type" = 'user' WHERE "target_type" IS NULL;--> statement-breakpoint
ALTER TABLE "moderation_cases" ALTER COLUMN "target_type" SET DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "moderation_cases" ALTER COLUMN "target_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_cases" ALTER COLUMN "target_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_target_check" CHECK (
    ("target_type" = 'user' AND "target_user_id" IS NOT NULL AND "target_channel_id" IS NULL)
    OR ("target_type" = 'channel' AND "target_channel_id" IS NOT NULL AND "target_user_id" IS NULL)
);--> statement-breakpoint
CREATE INDEX "moderation_cases_guild_channel_idx" ON "moderation_cases" USING btree ("guild_id","target_channel_id");
