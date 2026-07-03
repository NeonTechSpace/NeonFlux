export type GuildFeatureSettingInput = {
    config?: unknown;
    createdAt?: string | null;
    enabled?: boolean | null;
    feature?: string | null;
    guildId?: string | null;
    legacyId?: string | null;
    updatedAt?: string | null;
};

export type GuildFeatureSettingDocument = {
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    feature: string;
    guildId: string;
    legacyId: string;
    updatedAt: string;
};

export type GuildFeatureSettingRecord = {
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    feature: string;
    guildId: string;
    id: string;
    updatedAt: string;
};

export type GuildFeatureSettingInputError =
    | 'invalid-config'
    | 'invalid-created-at'
    | 'invalid-updated-at'
    | 'missing-feature'
    | 'missing-guild-id';

export type FeatureSettingInputResult<Value, ErrorValue extends string> =
    | { ok: true; value: Value }
    | { error: ErrorValue; ok: false };

export function buildGuildFeatureSettingDocument(
    input: GuildFeatureSettingInput,
    now: string,
    existing?: Pick<GuildFeatureSettingDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): FeatureSettingInputResult<GuildFeatureSettingDocument, GuildFeatureSettingInputError> {
    const guildId = normalizeOptionalString(input.guildId);
    const feature = normalizeOptionalString(input.feature);
    const config = normalizeConfig(input.config);
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId) {
        return { error: 'missing-guild-id', ok: false };
    }

    if (!feature) {
        return { error: 'missing-feature', ok: false };
    }

    if (!config.ok) {
        return config;
    }

    if (!createdAt) {
        return { error: 'invalid-created-at', ok: false };
    }

    if (!updatedAt) {
        return { error: 'invalid-updated-at', ok: false };
    }

    return {
        ok: true,
        value: {
            config: config.value,
            createdAt,
            enabled: input.enabled ?? false,
            feature,
            guildId,
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            updatedAt,
        },
    };
}

export function normalizeRequiredGuildFeatureString(
    value: string,
    missingError: 'missing-feature' | 'missing-guild-id'
): FeatureSettingInputResult<string, 'missing-feature' | 'missing-guild-id'> {
    const normalizedValue = normalizeOptionalString(value);

    return normalizedValue ? { ok: true, value: normalizedValue } : { error: missingError, ok: false };
}

export function normalizeGuildFeatureSettingLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return 100;
    }

    return Math.min(Math.max(Math.trunc(limit), 1), 500);
}

export function normalizeAfterFeature(value: string | undefined): string | undefined {
    return normalizeOptionalString(value);
}

export function toGuildFeatureSettingRecord(document: GuildFeatureSettingDocument): GuildFeatureSettingRecord {
    return {
        config: document.config,
        createdAt: document.createdAt,
        enabled: document.enabled,
        feature: document.feature,
        guildId: document.guildId,
        id: document.legacyId,
        updatedAt: document.updatedAt,
    };
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');

    if (!Number.isFinite(parsed)) {
        return undefined;
    }

    return new Date(parsed).toISOString();
}

function normalizeConfig(
    value: unknown
): FeatureSettingInputResult<Record<string, unknown>, Extract<GuildFeatureSettingInputError, 'invalid-config'>> {
    if (value === undefined) {
        return { ok: true, value: {} };
    }

    if (isPlainRecord(value)) {
        return { ok: true, value };
    }

    return { error: 'invalid-config', ok: false };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
