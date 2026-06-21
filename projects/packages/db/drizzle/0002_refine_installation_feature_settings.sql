DROP INDEX IF EXISTS "bot_installations_mode_idx";--> statement-breakpoint
ALTER TABLE "bot_installations" DROP COLUMN IF EXISTS "mode";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."instance_mode";--> statement-breakpoint
ALTER TABLE "feature_settings" RENAME TO "guild_feature_settings";--> statement-breakpoint
ALTER TABLE "guild_feature_settings" RENAME CONSTRAINT "feature_settings_guild_id_bot_installations_guild_id_fk" TO "guild_feature_settings_guild_id_bot_installations_guild_id_fk";--> statement-breakpoint
ALTER INDEX IF EXISTS "feature_settings_guild_feature_idx" RENAME TO "guild_feature_settings_guild_feature_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "feature_settings_guild_idx" RENAME TO "guild_feature_settings_guild_idx";
