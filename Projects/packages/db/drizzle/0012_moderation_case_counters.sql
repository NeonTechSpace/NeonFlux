CREATE TABLE "moderation_case_counters" (
    "guild_id" text PRIMARY KEY NOT NULL,
    "next_case_number" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moderation_case_counters" ADD CONSTRAINT "moderation_case_counters_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "moderation_case_counters" ("guild_id", "next_case_number")
SELECT "guild_id", COALESCE(MAX("case_number"), 0) + 1
FROM "moderation_cases"
GROUP BY "guild_id";
