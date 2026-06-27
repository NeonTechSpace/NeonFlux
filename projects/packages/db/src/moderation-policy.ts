import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { guildFeatureSettings } from './schema.js';

export const GUILD_MODERATION_POLICY_FEATURE = 'moderation';

export type GuildModerationPolicyRecord = {
    guildId: string;
    protectedUserIds: string[];
    protectedRoleIds: string[];
    createdAt: Date;
    updatedAt: Date;
};

export type GuildModerationPolicyRepositoryError = GuildFeatureRepositoryError | { type: 'invalid-config' };

type GuildModerationPolicyConfig = {
    protectedUserIds?: unknown;
    protectedRoleIds?: unknown;
};

type GuildFeatureSettingsRow = typeof guildFeatureSettings.$inferSelect;

export async function findGuildModerationPolicyByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string }
): Promise<Result<GuildModerationPolicyRecord, GuildModerationPolicyRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(guildFeatureSettings)
            .where(
                and(
                    eq(guildFeatureSettings.guildId, guildId.value),
                    eq(guildFeatureSettings.feature, GUILD_MODERATION_POLICY_FEATURE)
                )
            )
            .limit(1);
        const row = rows[0];

        if (!row) {
            return err({ type: 'not-found' });
        }

        return toGuildModerationPolicyRecord(row);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertGuildModerationPolicy(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        protectedUserIds?: readonly string[];
        protectedRoleIds?: readonly string[];
    }
): Promise<Result<GuildModerationPolicyRecord, GuildModerationPolicyRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    const protectedUserIds = normalizeIdList(input.protectedUserIds ?? []);
    const protectedRoleIds = normalizeIdList(input.protectedRoleIds ?? []);
    const updatedAt = new Date();

    try {
        const rows = await db
            .insert(guildFeatureSettings)
            .values({
                guildId: guildId.value,
                feature: GUILD_MODERATION_POLICY_FEATURE,
                enabled: true,
                config: {
                    protectedUserIds,
                    protectedRoleIds,
                },
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [guildFeatureSettings.guildId, guildFeatureSettings.feature],
                set: {
                    enabled: true,
                    config: {
                        protectedUserIds,
                        protectedRoleIds,
                    },
                    updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        if (!row) {
            return err({ type: 'database-error' });
        }

        return toGuildModerationPolicyRecord(row);
    } catch {
        return err({ type: 'database-error' });
    }
}

function toGuildModerationPolicyRecord(
    row: GuildFeatureSettingsRow
): Result<GuildModerationPolicyRecord, GuildModerationPolicyRepositoryError> {
    const config = row.config as GuildModerationPolicyConfig;
    const protectedUserIds = readConfigIdList(config.protectedUserIds);
    const protectedRoleIds = readConfigIdList(config.protectedRoleIds);

    if (!protectedUserIds || !protectedRoleIds) {
        return err({ type: 'invalid-config' });
    }

    return ok({
        guildId: row.guildId,
        protectedUserIds,
        protectedRoleIds,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    });
}

function readConfigIdList(value: unknown): string[] | undefined {
    if (value === undefined) {
        return [];
    }

    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        return undefined;
    }

    return normalizeIdList(value);
}

function normalizeIdList(values: readonly string[]): string[] {
    const normalizedIds = values
        .map((value) => normalizeOptionalText(value))
        .filter((value): value is string => Boolean(value));

    return [...new Set(normalizedIds)];
}
