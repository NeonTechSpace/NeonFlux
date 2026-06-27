import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeNonNegativeInteger,
    normalizeRequiredPositiveInteger,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { guildUserXp, xpGrants, xpRoleRewards, xpSettings } from './schema.js';

export type XpSettingsRecord = typeof xpSettings.$inferSelect;
export type GuildUserXpRecord = typeof guildUserXp.$inferSelect;
export type XpGrantRecord = typeof xpGrants.$inferSelect;
export type XpRoleRewardRecord = typeof xpRoleRewards.$inferSelect;
export type XpRepositoryError = GuildFeatureRepositoryError;
export type XpGrantSource = 'message' | 'voice';
export type GrantGuildUserXpResult =
    | { status: 'granted'; userXp: GuildUserXpRecord; grant: XpGrantRecord }
    | { status: 'duplicate'; userXp: GuildUserXpRecord | undefined };
export type GuildUserXpRank = {
    userXp: GuildUserXpRecord;
    rank: number;
};

const defaultMessageXpMin = 5;
const defaultMessageXpMax = 10;
const defaultCooldownSeconds = 60;
const defaultVoiceXpPerMinute = 2;
const defaultVoiceMinimumMinutes = 5;

export async function upsertXpSettings(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        enabled?: boolean;
        messageXpMin?: number;
        messageXpMax?: number;
        cooldownSeconds?: number;
        voiceXpPerMinute?: number;
        voiceMinimumMinutes?: number;
        config?: Record<string, unknown>;
    }
): Promise<Result<XpSettingsRecord, XpRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageXpMin = normalizeRequiredPositiveInteger(input.messageXpMin ?? defaultMessageXpMin, 'messageXpMin');
    const messageXpMax = normalizeRequiredPositiveInteger(input.messageXpMax ?? defaultMessageXpMax, 'messageXpMax');
    const cooldownSeconds = normalizeRequiredPositiveInteger(
        input.cooldownSeconds ?? defaultCooldownSeconds,
        'cooldownSeconds'
    );
    const voiceXpPerMinute = normalizeNonNegativeInteger(
        input.voiceXpPerMinute ?? defaultVoiceXpPerMinute,
        'voiceXpPerMinute'
    );
    const voiceMinimumMinutes = normalizeNonNegativeInteger(
        input.voiceMinimumMinutes ?? defaultVoiceMinimumMinutes,
        'voiceMinimumMinutes'
    );
    const updatedAt = new Date();

    if (guildId.isErr()) return err(guildId.error);
    if (messageXpMin.isErr()) return err(messageXpMin.error);
    if (messageXpMax.isErr()) return err(messageXpMax.error);
    if (cooldownSeconds.isErr()) return err(cooldownSeconds.error);
    if (voiceXpPerMinute.isErr()) return err(voiceXpPerMinute.error);
    if (voiceMinimumMinutes.isErr()) return err(voiceMinimumMinutes.error);

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
                voiceXpPerMinute: voiceXpPerMinute.value,
                voiceMinimumMinutes: voiceMinimumMinutes.value,
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
                    voiceXpPerMinute: voiceXpPerMinute.value,
                    voiceMinimumMinutes: voiceMinimumMinutes.value,
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

export async function findXpSettingsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string }
): Promise<Result<XpSettingsRecord, XpRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db.select().from(xpSettings).where(eq(xpSettings.guildId, guildId.value)).limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
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
                    messageXp: sql`${guildUserXp.messageXp} + ${input.xp}`,
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

export async function grantGuildUserXp(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        userId: string;
        source: XpGrantSource;
        xp: number;
        idempotencyKey: string;
        metadata?: Record<string, unknown>;
        occurredAt?: Date;
        voiceSeconds?: number;
    }
): Promise<Result<GrantGuildUserXpResult, XpRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, 'idempotencyKey');
    const xp = normalizeRequiredPositiveInteger(input.xp, 'xp');
    const voiceSeconds = normalizeNonNegativeInteger(input.voiceSeconds ?? 0, 'voiceSeconds');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);
    if (idempotencyKey.isErr()) return err(idempotencyKey.error);
    if (xp.isErr()) return err(xp.error);
    if (voiceSeconds.isErr()) return err(voiceSeconds.error);
    try {
        const result = await db.transaction(async (tx) => {
            const currentRows = await tx
                .select()
                .from(guildUserXp)
                .where(and(eq(guildUserXp.guildId, guildId.value), eq(guildUserXp.userId, userId.value)))
                .limit(1);
            const current = currentRows[0];
            const levelBefore = current?.level ?? 0;
            const totalXpAfter = (current?.xp ?? 0) + xp.value;
            const levelAfter = calculateXpLevel(totalXpAfter);
            const grantedAt = input.occurredAt ?? new Date();
            const grantRows = await tx
                .insert(xpGrants)
                .values({
                    guildId: guildId.value,
                    userId: userId.value,
                    source: input.source,
                    xp: xp.value,
                    levelBefore,
                    levelAfter,
                    idempotencyKey: idempotencyKey.value,
                    metadata: input.metadata ?? {},
                    grantedAt,
                })
                .onConflictDoNothing({
                    target: [xpGrants.guildId, xpGrants.idempotencyKey],
                })
                .returning();
            const grant = grantRows[0];

            if (!grant) {
                return {
                    status: 'duplicate' as const,
                    userXp: current,
                };
            }

            const userXpRows = await tx
                .insert(guildUserXp)
                .values({
                    guildId: guildId.value,
                    userId: userId.value,
                    xp: xp.value,
                    level: levelAfter,
                    messageXp: input.source === 'message' ? xp.value : 0,
                    voiceXp: input.source === 'voice' ? xp.value : 0,
                    messageCount: input.source === 'message' ? 1 : 0,
                    voiceSeconds: input.source === 'voice' ? voiceSeconds.value : 0,
                    ...(input.source === 'message' ? { lastMessageXpAt: grantedAt } : {}),
                    ...(input.source === 'voice' ? { lastVoiceXpAt: grantedAt } : {}),
                    updatedAt: grantedAt,
                })
                .onConflictDoUpdate({
                    target: [guildUserXp.guildId, guildUserXp.userId],
                    set: {
                        xp: sql`${guildUserXp.xp} + ${xp.value}`,
                        level: levelAfter,
                        ...(input.source === 'message'
                            ? {
                                  messageXp: sql`${guildUserXp.messageXp} + ${xp.value}`,
                                  messageCount: sql`${guildUserXp.messageCount} + 1`,
                                  lastMessageXpAt: grantedAt,
                              }
                            : {}),
                        ...(input.source === 'voice'
                            ? {
                                  voiceXp: sql`${guildUserXp.voiceXp} + ${xp.value}`,
                                  voiceSeconds: sql`${guildUserXp.voiceSeconds} + ${voiceSeconds.value}`,
                                  lastVoiceXpAt: grantedAt,
                              }
                            : {}),
                        updatedAt: grantedAt,
                    },
                })
                .returning();
            const userXp = userXpRows[0];

            if (!userXp) {
                throw new Error('Missing XP aggregate row.');
            }

            return {
                status: 'granted' as const,
                userXp,
                grant,
            };
        });

        return ok(result);
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

export async function findGuildUserXpRank(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; userId: string }
): Promise<Result<GuildUserXpRank, XpRepositoryError>> {
    const userXpResult = await findGuildUserXp(db, input);

    if (userXpResult.isErr()) {
        return err(userXpResult.error);
    }

    try {
        const rows = await db
            .select({ higherCount: sql<number>`count(*)::int` })
            .from(guildUserXp)
            .where(
                and(
                    eq(guildUserXp.guildId, userXpResult.value.guildId),
                    sql`${guildUserXp.xp} > ${userXpResult.value.xp}`
                )
            );
        const higherCount = rows[0]?.higherCount ?? 0;

        return ok({
            userXp: userXpResult.value,
            rank: higherCount + 1,
        });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listGuildXpLeaderboard(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; limit?: number }
): Promise<Result<GuildUserXpRecord[], XpRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeRequiredPositiveInteger(input.limit ?? 10, 'limit');

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const rows = await db
            .select()
            .from(guildUserXp)
            .where(eq(guildUserXp.guildId, guildId.value))
            .orderBy(desc(guildUserXp.xp), desc(guildUserXp.level), asc(guildUserXp.userId))
            .limit(limit.value);

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export function calculateXpLevel(xp: number): number {
    if (!Number.isFinite(xp) || xp <= 0) {
        return 0;
    }

    return Math.floor(Math.sqrt(xp / 100));
}
