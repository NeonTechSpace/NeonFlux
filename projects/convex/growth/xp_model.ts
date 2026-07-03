export type XpGrantSource = 'message' | 'voice';

export type XpSettingsInput = {
    config?: Record<string, unknown> | null;
    cooldownSeconds?: number | null;
    enabled?: boolean | null;
    guildId?: string | null;
    messageXpMax?: number | null;
    messageXpMin?: number | null;
    updatedAt?: string | null;
    voiceMinimumMinutes?: number | null;
    voiceXpPerMinute?: number | null;
};

export type XpSettingsDocument = {
    config: Record<string, unknown>;
    cooldownSeconds: number;
    enabled: boolean;
    guildId: string;
    messageXpMax: number;
    messageXpMin: number;
    updatedAt: string;
    voiceMinimumMinutes: number;
    voiceXpPerMinute: number;
};

export type GuildUserXpDocument = {
    guildId: string;
    lastMessageXpAt?: string;
    lastVoiceXpAt?: string;
    legacyId: string;
    level: number;
    messageCount: number;
    messageXp: number;
    updatedAt: string;
    userId: string;
    voiceSeconds: number;
    voiceXp: number;
    xp: number;
};

export type XpGrantDocument = {
    grantedAt: string;
    guildId: string;
    idempotencyKey: string;
    legacyId: string;
    levelAfter: number;
    levelBefore: number;
    metadata: Record<string, unknown>;
    source: XpGrantSource;
    userId: string;
    xp: number;
};

export type XpRoleRewardDocument = {
    createdAt: string;
    guildId: string;
    legacyId: string;
    level: number;
    roleId: string;
    updatedAt: string;
};

export type XpInputError = { field: string; type: 'invalid-value' | 'missing-input' };
export type XpInputResult<Value> = { ok: true; value: Value } | { error: XpInputError; ok: false };

const defaultMessageXpMin = 5;
const defaultMessageXpMax = 10;
const defaultCooldownSeconds = 60;
const defaultVoiceXpPerMinute = 2;
const defaultVoiceMinimumMinutes = 5;

export function buildXpSettingsDocument(input: XpSettingsInput, now: string): XpInputResult<XpSettingsDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const messageXpMin = normalizePositiveInteger(input.messageXpMin ?? defaultMessageXpMin, 'messageXpMin');
    const messageXpMax = normalizePositiveInteger(input.messageXpMax ?? defaultMessageXpMax, 'messageXpMax');
    const cooldownSeconds = normalizePositiveInteger(
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
    const config = normalizeRecord(input.config ?? {});
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) return guildId;
    if (!messageXpMin.ok) return messageXpMin;
    if (!messageXpMax.ok) return messageXpMax;
    if (!cooldownSeconds.ok) return cooldownSeconds;
    if (!voiceXpPerMinute.ok) return voiceXpPerMinute;
    if (!voiceMinimumMinutes.ok) return voiceMinimumMinutes;
    if (messageXpMin.value > messageXpMax.value) {
        return { error: { field: 'messageXpMin', type: 'invalid-value' }, ok: false };
    }
    if (!config) return { error: { field: 'config', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            config,
            cooldownSeconds: cooldownSeconds.value,
            enabled: input.enabled ?? false,
            guildId: guildId.value,
            messageXpMax: messageXpMax.value,
            messageXpMin: messageXpMin.value,
            updatedAt,
            voiceMinimumMinutes: voiceMinimumMinutes.value,
            voiceXpPerMinute: voiceXpPerMinute.value,
        },
    };
}

export function buildGuildUserXpDocument(
    input: {
        guildId?: string | null;
        legacyId?: string | null;
        level?: number | null;
        userId?: string | null;
        xp?: number | null;
    },
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): XpInputResult<GuildUserXpDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const userId = normalizeRequiredString(input.userId, 'userId');
    const xp = normalizeNonNegativeInteger(input.xp ?? 0, 'xp');
    const level = normalizeNonNegativeInteger(input.level ?? 0, 'level');

    if (!guildId.ok) return guildId;
    if (!userId.ok) return userId;
    if (!xp.ok) return xp;
    if (!level.ok) return level;

    return {
        ok: true,
        value: {
            guildId: guildId.value,
            lastMessageXpAt: now,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
            level: level.value,
            messageCount: 1,
            messageXp: xp.value,
            updatedAt: now,
            userId: userId.value,
            voiceSeconds: 0,
            voiceXp: 0,
            xp: xp.value,
        },
    };
}

export function buildXpGrantDocument(
    input: {
        guildId?: string | null;
        idempotencyKey?: string | null;
        legacyId?: string | null;
        metadata?: Record<string, unknown> | null;
        occurredAt?: string | null;
        source?: string | null;
        userId?: string | null;
        xp?: number | null;
    },
    levelBefore: number,
    levelAfter: number,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): XpInputResult<XpGrantDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const userId = normalizeRequiredString(input.userId, 'userId');
    const idempotencyKey = normalizeRequiredString(input.idempotencyKey, 'idempotencyKey');
    const source = normalizeGrantSource(input.source);
    const xp = normalizePositiveInteger(input.xp, 'xp');
    const metadata = normalizeRecord(input.metadata ?? {});
    const grantedAt = input.occurredAt === undefined ? now : normalizeTimestamp(input.occurredAt);

    if (!guildId.ok) return guildId;
    if (!userId.ok) return userId;
    if (!idempotencyKey.ok) return idempotencyKey;
    if (!source.ok) return source;
    if (!xp.ok) return xp;
    if (!metadata) return { error: { field: 'metadata', type: 'invalid-value' }, ok: false };
    if (!grantedAt) return { error: { field: 'occurredAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            grantedAt,
            guildId: guildId.value,
            idempotencyKey: idempotencyKey.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
            levelAfter,
            levelBefore,
            metadata,
            source: source.value,
            userId: userId.value,
            xp: xp.value,
        },
    };
}

export function buildXpRoleRewardDocument(
    input: { guildId?: string | null; legacyId?: string | null; level?: number | null; roleId?: string | null },
    now: string,
    existing?: Pick<XpRoleRewardDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): XpInputResult<XpRoleRewardDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const level = normalizePositiveInteger(input.level, 'level');
    const roleId = normalizeRequiredString(input.roleId, 'roleId');

    if (!guildId.ok) return guildId;
    if (!level.ok) return level;
    if (!roleId.ok) return roleId;

    return {
        ok: true,
        value: {
            createdAt: existing?.createdAt ?? now,
            guildId: guildId.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            level: level.value,
            roleId: roleId.value,
            updatedAt: now,
        },
    };
}

export function applyXpGrant(
    current: GuildUserXpDocument | null,
    grant: XpGrantDocument,
    voiceSeconds: number,
    createLegacyId: () => string = () => crypto.randomUUID()
): GuildUserXpDocument {
    const xp = (current?.xp ?? 0) + grant.xp;
    const now = grant.grantedAt;
    const lastMessageXpAt = grant.source === 'message' ? now : current?.lastMessageXpAt;
    const lastVoiceXpAt = grant.source === 'voice' ? now : current?.lastVoiceXpAt;

    return {
        guildId: grant.guildId,
        ...(lastMessageXpAt === undefined ? {} : { lastMessageXpAt }),
        ...(lastVoiceXpAt === undefined ? {} : { lastVoiceXpAt }),
        legacyId: current?.legacyId ?? createLegacyId(),
        level: calculateXpLevel(xp),
        messageCount: (current?.messageCount ?? 0) + (grant.source === 'message' ? 1 : 0),
        messageXp: (current?.messageXp ?? 0) + (grant.source === 'message' ? grant.xp : 0),
        updatedAt: now,
        userId: grant.userId,
        voiceSeconds: (current?.voiceSeconds ?? 0) + (grant.source === 'voice' ? voiceSeconds : 0),
        voiceXp: (current?.voiceXp ?? 0) + (grant.source === 'voice' ? grant.xp : 0),
        xp,
    };
}

export function calculateXpLevel(xp: number): number {
    return Number.isFinite(xp) && xp > 0 ? Math.floor(Math.sqrt(xp / 100)) : 0;
}

export const normalizeRequiredGuildId = (value: string) => normalizeRequiredString(value, 'guildId');
export const normalizeRequiredUserId = (value: string) => normalizeRequiredString(value, 'userId');
export const normalizeRequiredRoleId = (value: string) => normalizeRequiredString(value, 'roleId');

export function normalizeXpLimit(limit: number | undefined, fallback = 10, max = 100): number {
    if (limit === undefined || !Number.isFinite(limit)) return fallback;

    return Math.min(Math.max(Math.trunc(limit), 1), max);
}

export function normalizeXpVoiceSeconds(value: number | undefined): XpInputResult<number> {
    return normalizeNonNegativeInteger(value ?? 0, 'voiceSeconds');
}

export function toXpSettingsRecord(document: XpSettingsDocument) {
    return document;
}

export function toGuildUserXpRecord(document: GuildUserXpDocument) {
    return {
        ...document,
        id: document.legacyId,
        lastMessageXpAt: document.lastMessageXpAt ?? null,
        lastVoiceXpAt: document.lastVoiceXpAt ?? null,
    };
}

export function toXpGrantRecord(document: XpGrantDocument) {
    return { ...document, id: document.legacyId };
}

export function toXpRoleRewardRecord(document: XpRoleRewardDocument) {
    return { ...document, id: document.legacyId };
}

function normalizeRequiredString(value: string | null | undefined, field: string): XpInputResult<string> {
    const normalizedValue = value?.trim();

    return normalizedValue
        ? { ok: true, value: normalizedValue }
        : { error: { field, type: 'missing-input' }, ok: false };
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');

    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function normalizeRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function normalizePositiveInteger(value: number | null | undefined, field: string): XpInputResult<number> {
    return Number.isInteger(value) && Number(value) > 0
        ? { ok: true, value: Number(value) }
        : { error: { field, type: 'invalid-value' }, ok: false };
}

function normalizeNonNegativeInteger(value: number | null | undefined, field: string): XpInputResult<number> {
    return Number.isInteger(value) && Number(value) >= 0
        ? { ok: true, value: Number(value) }
        : { error: { field, type: 'invalid-value' }, ok: false };
}

function normalizeGrantSource(value: string | null | undefined): XpInputResult<XpGrantSource> {
    const normalizedValue = value?.trim();

    if (normalizedValue === 'message' || normalizedValue === 'voice') return { ok: true, value: normalizedValue };

    return { error: { field: 'source', type: normalizedValue ? 'invalid-value' : 'missing-input' }, ok: false };
}
