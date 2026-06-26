import { and, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeRequiredPositiveInteger,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { guildUserXp, xpRoleRewards, xpSettings } from './schema.js';

export type XpSettingsRecord = typeof xpSettings.$inferSelect;
export type GuildUserXpRecord = typeof guildUserXp.$inferSelect;
export type XpRoleRewardRecord = typeof xpRoleRewards.$inferSelect;
export type XpRepositoryError = GuildFeatureRepositoryError;

export async function upsertXpSettings(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        enabled?: boolean;
        messageXpMin?: number;
        messageXpMax?: number;
        cooldownSeconds?: number;
        config?: Record<string, unknown>;
    }
): Promise<Result<XpSettingsRecord, XpRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageXpMin = normalizeRequiredPositiveInteger(input.messageXpMin ?? 5, 'messageXpMin');
    const messageXpMax = normalizeRequiredPositiveInteger(input.messageXpMax ?? 10, 'messageXpMax');
    const cooldownSeconds = normalizeRequiredPositiveInteger(input.cooldownSeconds ?? 60, 'cooldownSeconds');
    const updatedAt = new Date();

    if (guildId.isErr()) return err(guildId.error);
    if (messageXpMin.isErr()) return err(messageXpMin.error);
    if (messageXpMax.isErr()) return err(messageXpMax.error);
    if (cooldownSeconds.isErr()) return err(cooldownSeconds.error);

    if (messageXpMin.value > messageXpMax.value) {
        return err({ type: 'invalid-value', field: 'messageXpMin' });
    }

    try {
        const rows = await db
            .insert(xpSettings)
            .values({
                guildId: guildId.value,
                enabled: input.enabled ?? false,
                messageXpMin: messageXpMin.value,
                messageXpMax: messageXpMax.value,
                cooldownSeconds: cooldownSeconds.value,
                config: input.config ?? {},
                updatedAt,
            })
            .onConflictDoUpdate({
                target: xpSettings.guildId,
                set: {
                    enabled: input.enabled ?? false,
                    messageXpMin: messageXpMin.value,
                    messageXpMax: messageXpMax.value,
                    cooldownSeconds: cooldownSeconds.value,
                    config: input.config ?? {},
                    updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function addGuildUserXp(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; userId: string; xp: number; level: number }
): Promise<Result<GuildUserXpRecord, XpRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);

    if (!Number.isInteger(input.xp) || input.xp < 0) {
        return err({ type: 'invalid-value', field: 'xp' });
    }

    if (!Number.isInteger(input.level) || input.level < 0) {
        return err({ type: 'invalid-value', field: 'level' });
    }

    try {
        const rows = await db
            .insert(guildUserXp)
            .values({
                guildId: guildId.value,
                userId: userId.value,
                xp: input.xp,
                level: input.level,
                messageCount: 1,
                lastMessageXpAt: new Date(),
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: [guildUserXp.guildId, guildUserXp.userId],
                set: {
                    xp: sql`${guildUserXp.xp} + ${input.xp}`,
                    level: input.level,
                    messageCount: sql`${guildUserXp.messageCount} + 1`,
                    lastMessageXpAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertXpRoleReward(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; level: number; roleId: string }
): Promise<Result<XpRoleRewardRecord, XpRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const level = normalizeRequiredPositiveInteger(input.level, 'level');
    const roleId = normalizeRequiredText(input.roleId, 'roleId');
    const updatedAt = new Date();

    if (guildId.isErr()) return err(guildId.error);
    if (level.isErr()) return err(level.error);
    if (roleId.isErr()) return err(roleId.error);

    try {
        const rows = await db
            .insert(xpRoleRewards)
            .values({
                guildId: guildId.value,
                level: level.value,
                roleId: roleId.value,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [xpRoleRewards.guildId, xpRoleRewards.level, xpRoleRewards.roleId],
                set: {
                    updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findGuildUserXp(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; userId: string }
): Promise<Result<GuildUserXpRecord, XpRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const rows = await db
            .select()
            .from(guildUserXp)
            .where(and(eq(guildUserXp.guildId, guildId.value), eq(guildUserXp.userId, userId.value)))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}
