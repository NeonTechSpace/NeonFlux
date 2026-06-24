import { normalizeCommandPrefix } from '@neonflux/core/command-prefix';
import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core/db';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';
import { err, ok, type Result } from 'neverthrow';

import type * as schema from './schema.js';
import { guildFeatureSettings } from './schema.js';

export const GUILD_COMMAND_SETTINGS_FEATURE = 'commands';

export type GuildCommandSettingsRecord = {
    guildId: string;
    prefix: string;
    createdAt: Date;
    updatedAt: Date;
};

export type GuildCommandSettingsRepositoryError =
    | 'missing-guild-id'
    | 'invalid-prefix'
    | 'invalid-config'
    | 'not-found'
    | 'database-error';

type GuildCommandSettingsDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
type GuildFeatureSettingsRow = typeof guildFeatureSettings.$inferSelect;

export async function findGuildCommandSettingsByGuildId(
    db: GuildCommandSettingsDatabase,
    input: { guildId: string }
): Promise<Result<GuildCommandSettingsRecord, GuildCommandSettingsRepositoryError>> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    try {
        const settings = await db
            .select()
            .from(guildFeatureSettings)
            .where(
                and(
                    eq(guildFeatureSettings.guildId, guildIdResult.value),
                    eq(guildFeatureSettings.feature, GUILD_COMMAND_SETTINGS_FEATURE)
                )
            )
            .limit(1);
        const setting = settings[0];

        if (!setting) {
            return err('not-found');
        }

        return toGuildCommandSettingsRecord(setting);
    } catch {
        return err('database-error');
    }
}

export async function upsertGuildCommandPrefix(
    db: GuildCommandSettingsDatabase,
    input: { guildId: string; prefix: string }
): Promise<Result<GuildCommandSettingsRecord, GuildCommandSettingsRepositoryError>> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    const prefixResult = normalizeCommandPrefix(input.prefix);

    if (prefixResult.isErr()) {
        return err(prefixResult.error);
    }

    const updatedAt = new Date();

    try {
        const settings = await db
            .insert(guildFeatureSettings)
            .values({
                guildId: guildIdResult.value,
                feature: GUILD_COMMAND_SETTINGS_FEATURE,
                enabled: true,
                config: {
                    prefix: prefixResult.value,
                },
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [guildFeatureSettings.guildId, guildFeatureSettings.feature],
                set: {
                    enabled: true,
                    config: {
                        prefix: prefixResult.value,
                    },
                    updatedAt,
                },
            })
            .returning();
        const setting = settings[0];

        if (!setting) {
            return err('database-error');
        }

        return toGuildCommandSettingsRecord(setting);
    } catch {
        return err('database-error');
    }
}

function normalizeGuildId(guildId: string): Result<string, 'missing-guild-id'> {
    const normalizedGuildId = guildId.trim();

    if (normalizedGuildId.length === 0) {
        return err('missing-guild-id');
    }

    return ok(normalizedGuildId);
}

function toGuildCommandSettingsRecord(
    setting: GuildFeatureSettingsRow
): Result<GuildCommandSettingsRecord, GuildCommandSettingsRepositoryError> {
    const prefix = setting.config.prefix;

    if (typeof prefix !== 'string') {
        return err('invalid-config');
    }

    const prefixResult = normalizeCommandPrefix(prefix);

    if (prefixResult.isErr()) {
        return err('invalid-config');
    }

    return ok({
        guildId: setting.guildId,
        prefix: prefixResult.value,
        createdAt: setting.createdAt,
        updatedAt: setting.updatedAt,
    });
}
