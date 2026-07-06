import { api } from '@neonflux/convex-api';
import { err, ok, type Result } from 'neverthrow';

import type { GuildFeatureRepositoryError } from './contracts.js';
import type {
    GrantGuildUserXpResult,
    GuildUserXpRank,
    GuildUserXpRecord,
    XpGrantRecord,
    XpGrantSource,
    XpRepositoryError,
    XpRoleRewardRecord,
    XpSettingsRecord,
} from './contracts-xp.js';

import type { ConvexDatabase } from './convex.js';

type XpDb = ConvexDatabase;

type ConvexXpSettingsRecord = Omit<XpSettingsRecord, 'updatedAt'> & { updatedAt: string };
type ConvexGuildUserXpRecord = Omit<GuildUserXpRecord, 'lastMessageXpAt' | 'lastVoiceXpAt' | 'updatedAt'> & {
    lastMessageXpAt: string | null;
    lastVoiceXpAt: string | null;
    updatedAt: string;
};
type ConvexXpGrantRecord = Omit<XpGrantRecord, 'grantedAt'> & {
    grantedAt: string;
};
type ConvexXpRoleRewardRecord = Omit<XpRoleRewardRecord, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
};
type ConvexGrantGuildUserXpResult =
    | { grant: ConvexXpGrantRecord; status: 'granted'; userXp: ConvexGuildUserXpRecord }
    | { status: 'duplicate'; userXp: ConvexGuildUserXpRecord | null };

export async function upsertXpSettings(
    db: XpDb,
    input: {
        config?: Record<string, unknown>;
        cooldownSeconds?: number;
        enabled?: boolean;
        guildId: string;
        messageXpMax?: number;
        messageXpMin?: number;
        voiceMinimumMinutes?: number;
        voiceXpPerMinute?: number;
    }
): Promise<Result<XpSettingsRecord, XpRepositoryError>> {
    const normalizedInput = normalizeXpSettingsInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const settings = await db.client.mutation(
            api.xp.upsertXpSettings,
            normalizedInput.value
        );

        return ok(toXpSettingsRecord(settings));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findXpSettingsByGuildId(
    db: XpDb,
    input: { guildId: string }
): Promise<Result<XpSettingsRecord, XpRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const settings = await db.client.query(api.xp.findXpSettingsByGuildId, {
            guildId: guildId.value,
        });

        return settings ? ok(toXpSettingsRecord(settings)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function addGuildUserXp(
    db: XpDb,
    input: { guildId: string; level: number; userId: string; xp: number }
): Promise<Result<GuildUserXpRecord, XpRepositoryError>> {
    const normalizedInput = normalizeAddGuildUserXpInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const userXp = await db.client.mutation(api.xp.addGuildUserXp, normalizedInput.value);

        return ok(toGuildUserXpRecord(userXp));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function grantGuildUserXp(
    db: XpDb,
    input: {
        guildId: string;
        idempotencyKey: string;
        metadata?: Record<string, unknown>;
        occurredAt?: Date;
        source: XpGrantSource;
        userId: string;
        voiceSeconds?: number;
        xp: number;
    }
): Promise<Result<GrantGuildUserXpResult, XpRepositoryError>> {
    const normalizedInput = normalizeGrantGuildUserXpInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const result = await db.client.mutation(
            api.xp.grantGuildUserXp,
            normalizedInput.value
        );

        return ok(toGrantGuildUserXpResult(result));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertXpRoleReward(
    db: XpDb,
    input: { guildId: string; level: number; roleId: string }
): Promise<Result<XpRoleRewardRecord, XpRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const level = normalizePositiveInteger(input.level, 'level');
    const roleId = normalizeRequiredText(input.roleId, 'roleId');

    if (guildId.isErr()) return err(guildId.error);
    if (level.isErr()) return err(level.error);
    if (roleId.isErr()) return err(roleId.error);

    try {
        const reward = await db.client.mutation(api.xp.upsertXpRoleReward, {
            guildId: guildId.value,
            level: level.value,
            roleId: roleId.value,
        });

        return ok(toXpRoleRewardRecord(reward));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findGuildUserXp(
    db: XpDb,
    input: { guildId: string; userId: string }
): Promise<Result<GuildUserXpRecord, XpRepositoryError>> {
    const normalizedInput = normalizeGuildUserInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const userXp = await db.client.query(
            api.xp.findGuildUserXp,
            normalizedInput.value
        );

        return userXp ? ok(toGuildUserXpRecord(userXp)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findGuildUserXpRank(
    db: XpDb,
    input: { guildId: string; userId: string }
): Promise<Result<GuildUserXpRank, XpRepositoryError>> {
    const normalizedInput = normalizeGuildUserInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const rank = await db.client.query(api.xp.findGuildUserXpRank, normalizedInput.value);

        return rank ? ok({ rank: rank.rank, userXp: toGuildUserXpRecord(rank.userXp) }) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listGuildXpLeaderboard(
    db: XpDb,
    input: { guildId: string; limit?: number }
): Promise<Result<GuildUserXpRecord[], XpRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizePositiveInteger(input.limit ?? 10, 'limit');

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const leaderboard = await db.client.query(api.xp.listGuildXpLeaderboard, {
            guildId: guildId.value,
            limit: limit.value,
        });

        return ok(leaderboard.map(toGuildUserXpRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeXpSettingsInput(input: {
    config?: Record<string, unknown>;
    cooldownSeconds?: number;
    enabled?: boolean;
    guildId: string;
    messageXpMax?: number;
    messageXpMin?: number;
    voiceMinimumMinutes?: number;
    voiceXpPerMinute?: number;
}): Result<
    {
        config?: Record<string, unknown>;
        cooldownSeconds?: number;
        enabled?: boolean;
        guildId: string;
        messageXpMax?: number;
        messageXpMin?: number;
        voiceMinimumMinutes?: number;
        voiceXpPerMinute?: number;
    },
    XpRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageXpMin = normalizeOptionalPositiveInteger(input.messageXpMin, 'messageXpMin');
    const messageXpMax = normalizeOptionalPositiveInteger(input.messageXpMax, 'messageXpMax');
    const cooldownSeconds = normalizeOptionalPositiveInteger(input.cooldownSeconds, 'cooldownSeconds');
    const voiceXpPerMinute = normalizeOptionalNonNegativeInteger(input.voiceXpPerMinute, 'voiceXpPerMinute');
    const voiceMinimumMinutes = normalizeOptionalNonNegativeInteger(input.voiceMinimumMinutes, 'voiceMinimumMinutes');
    const config = normalizeOptionalRecord(input.config, 'config');

    if (guildId.isErr()) return err(guildId.error);
    if (messageXpMin.isErr()) return err(messageXpMin.error);
    if (messageXpMax.isErr()) return err(messageXpMax.error);
    if (cooldownSeconds.isErr()) return err(cooldownSeconds.error);
    if (voiceXpPerMinute.isErr()) return err(voiceXpPerMinute.error);
    if (voiceMinimumMinutes.isErr()) return err(voiceMinimumMinutes.error);
    if (config.isErr()) return err(config.error);
    if (
        messageXpMin.value !== undefined &&
        messageXpMax.value !== undefined &&
        messageXpMin.value > messageXpMax.value
    ) {
        return err({ field: 'messageXpMin', type: 'invalid-value' });
    }

    return ok({
        ...(config.value === undefined ? {} : { config: config.value }),
        ...(cooldownSeconds.value === undefined ? {} : { cooldownSeconds: cooldownSeconds.value }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        guildId: guildId.value,
        ...(messageXpMax.value === undefined ? {} : { messageXpMax: messageXpMax.value }),
        ...(messageXpMin.value === undefined ? {} : { messageXpMin: messageXpMin.value }),
        ...(voiceMinimumMinutes.value === undefined ? {} : { voiceMinimumMinutes: voiceMinimumMinutes.value }),
        ...(voiceXpPerMinute.value === undefined ? {} : { voiceXpPerMinute: voiceXpPerMinute.value }),
    });
}

function normalizeAddGuildUserXpInput(input: {
    guildId: string;
    level: number;
    userId: string;
    xp: number;
}): Result<{ guildId: string; level: number; userId: string; xp: number }, XpRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const xp = normalizeNonNegativeInteger(input.xp, 'xp');
    const level = normalizeNonNegativeInteger(input.level, 'level');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);
    if (xp.isErr()) return err(xp.error);
    if (level.isErr()) return err(level.error);

    return ok({ guildId: guildId.value, level: level.value, userId: userId.value, xp: xp.value });
}

function normalizeGrantGuildUserXpInput(input: {
    guildId: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    occurredAt?: Date;
    source: XpGrantSource;
    userId: string;
    voiceSeconds?: number;
    xp: number;
}): Result<
    {
        guildId: string;
        idempotencyKey: string;
        metadata?: Record<string, unknown>;
        occurredAt?: string;
        source: XpGrantSource;
        userId: string;
        voiceSeconds?: number;
        xp: number;
    },
    XpRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, 'idempotencyKey');
    const source = normalizeGrantSource(input.source);
    const xp = normalizePositiveInteger(input.xp, 'xp');
    const voiceSeconds = normalizeOptionalNonNegativeInteger(input.voiceSeconds, 'voiceSeconds');
    const occurredAt = input.occurredAt ? normalizeDate(input.occurredAt, 'occurredAt') : ok(undefined);
    const metadata = normalizeOptionalRecord(input.metadata, 'metadata');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);
    if (idempotencyKey.isErr()) return err(idempotencyKey.error);
    if (source.isErr()) return err(source.error);
    if (xp.isErr()) return err(xp.error);
    if (voiceSeconds.isErr()) return err(voiceSeconds.error);
    if (occurredAt.isErr()) return err(occurredAt.error);
    if (metadata.isErr()) return err(metadata.error);

    return ok({
        guildId: guildId.value,
        idempotencyKey: idempotencyKey.value,
        ...(metadata.value === undefined ? {} : { metadata: metadata.value }),
        ...(occurredAt.value === undefined ? {} : { occurredAt: occurredAt.value }),
        source: source.value,
        userId: userId.value,
        ...(voiceSeconds.value === undefined ? {} : { voiceSeconds: voiceSeconds.value }),
        xp: xp.value,
    });
}

function normalizeGuildUserInput(input: {
    guildId: string;
    userId: string;
}): Result<{ guildId: string; userId: string }, XpRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);

    return ok({ guildId: guildId.value, userId: userId.value });
}

function toXpSettingsRecord(record: ConvexXpSettingsRecord): XpSettingsRecord {
    return { ...record, updatedAt: new Date(record.updatedAt) };
}

function toGuildUserXpRecord(record: ConvexGuildUserXpRecord): GuildUserXpRecord {
    return {
        guildId: record.guildId,
        id: record.id,
        lastMessageXpAt: record.lastMessageXpAt ? new Date(record.lastMessageXpAt) : null,
        lastVoiceXpAt: record.lastVoiceXpAt ? new Date(record.lastVoiceXpAt) : null,
        level: record.level,
        messageCount: record.messageCount,
        messageXp: record.messageXp,
        updatedAt: new Date(record.updatedAt),
        userId: record.userId,
        voiceSeconds: record.voiceSeconds,
        voiceXp: record.voiceXp,
        xp: record.xp,
    };
}

function toXpGrantRecord(record: ConvexXpGrantRecord): XpGrantRecord {
    return {
        grantedAt: new Date(record.grantedAt),
        guildId: record.guildId,
        id: record.id,
        idempotencyKey: record.idempotencyKey,
        levelAfter: record.levelAfter,
        levelBefore: record.levelBefore,
        metadata: record.metadata,
        source: record.source,
        userId: record.userId,
        xp: record.xp,
    };
}

function toXpRoleRewardRecord(record: ConvexXpRoleRewardRecord): XpRoleRewardRecord {
    return {
        createdAt: new Date(record.createdAt),
        guildId: record.guildId,
        id: record.id,
        level: record.level,
        roleId: record.roleId,
        updatedAt: new Date(record.updatedAt),
    };
}

function toGrantGuildUserXpResult(result: ConvexGrantGuildUserXpResult): GrantGuildUserXpResult {
    return result.status === 'duplicate'
        ? { status: 'duplicate', userXp: result.userXp ? toGuildUserXpRecord(result.userXp) : undefined }
        : { grant: toXpGrantRecord(result.grant), status: 'granted', userXp: toGuildUserXpRecord(result.userXp) };
}

function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    return normalizedValue ? ok(normalizedValue) : err({ field, type: 'missing-input' });
}

function normalizeGrantSource(value: string): Result<XpGrantSource, GuildFeatureRepositoryError> {
    return value === 'message' || value === 'voice'
        ? ok(value)
        : err({ field: 'source', type: value ? 'invalid-value' : 'missing-input' });
}

function normalizePositiveInteger(value: number, field: string): Result<number, GuildFeatureRepositoryError> {
    return Number.isInteger(value) && value > 0 ? ok(value) : err({ field, type: 'invalid-value' });
}

function normalizeNonNegativeInteger(value: number, field: string): Result<number, GuildFeatureRepositoryError> {
    return Number.isInteger(value) && value >= 0 ? ok(value) : err({ field, type: 'invalid-value' });
}

function normalizeOptionalPositiveInteger(
    value: number | undefined,
    field: string
): Result<number | undefined, GuildFeatureRepositoryError> {
    return value === undefined ? ok(undefined) : normalizePositiveInteger(value, field);
}

function normalizeOptionalNonNegativeInteger(
    value: number | undefined,
    field: string
): Result<number | undefined, GuildFeatureRepositoryError> {
    return value === undefined ? ok(undefined) : normalizeNonNegativeInteger(value, field);
}

function normalizeOptionalRecord(
    value: Record<string, unknown> | undefined,
    field: string
): Result<Record<string, unknown> | undefined, GuildFeatureRepositoryError> {
    if (value === undefined || isRecord(value)) return ok(value);

    return err({ field, type: 'invalid-value' });
}

function normalizeDate(value: Date, field: string): Result<string, GuildFeatureRepositoryError> {
    const timestamp = value.getTime();

    return Number.isFinite(timestamp) ? ok(value.toISOString()) : err({ field, type: 'invalid-value' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
