ALTER TABLE "guild_command_permission_rules" ADD COLUMN "target_type" text;
--> statement-breakpoint
ALTER TABLE "guild_command_permission_rules" ADD COLUMN "target_id" text;
--> statement-breakpoint
UPDATE "guild_command_permission_rules"
SET
    "target_type" = 'category',
    "target_id" = "category"
WHERE "target_type" IS NULL OR "target_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "guild_command_permission_rules" ALTER COLUMN "target_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "guild_command_permission_rules" ALTER COLUMN "target_id" SET NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "guild_command_permission_rules_guild_category_idx";
--> statement-breakpoint
ALTER TABLE "guild_command_permission_rules" DROP COLUMN "category";
--> statement-breakpoint
ALTER TABLE "guild_command_permission_rules"
ADD CONSTRAINT "guild_command_permission_rules_target_type_check"
CHECK ("target_type" in ('category', 'command'));
--> statement-breakpoint
CREATE UNIQUE INDEX "guild_command_permission_rules_guild_target_idx"
ON "guild_command_permission_rules" USING btree ("guild_id", "target_type", "target_id");
