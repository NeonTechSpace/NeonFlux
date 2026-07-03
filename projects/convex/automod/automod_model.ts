export const automodTriggerTypes = ['blocked_terms', 'invite_links'] as const;
export type AutomodTriggerType = (typeof automodTriggerTypes)[number];

export const automodActionTypes = ['record', 'delete_message', 'timeout', 'warn'] as const;
export type AutomodActionType = (typeof automodActionTypes)[number];

export type AutomodRuleConfig = {
    ignoredChannelIds?: string[];
    ignoredRoleIds?: string[];
    ignoredUserIds?: string[];
    terms?: string[];
    timeoutDurationSeconds?: number;
};

export type AutomodRuleInput = {
    actionType?: string | null;
    config?: Record<string, unknown> | null;
    createdAt?: string | null;
    enabled?: boolean | null;
    guildId?: string | null;
    legacyId?: string | null;
    name?: string | null;
    ruleId?: string | null;
    triggerType?: string | null;
    updatedAt?: string | null;
};

export type AutomodRuleDocument = {
    actionType: AutomodActionType;
    config: AutomodRuleConfig;
    createdAt: string;
    enabled: boolean;
    guildId: string;
    legacyId: string;
    name: string;
    triggerType: AutomodTriggerType;
    updatedAt: string;
};

export type AutomodRuleRecord = {
    actionType: AutomodActionType;
    config: AutomodRuleConfig;
    createdAt: string;
    enabled: boolean;
    guildId: string;
    id: string;
    name: string;
    triggerType: AutomodTriggerType;
    updatedAt: string;
};

export type AutomodEventInput = {
    actionType?: string | null;
    authorUserId?: string | null;
    channelId?: string | null;
    createdAt?: string | null;
    details?: Record<string, unknown> | null;
    guildId?: string | null;
    legacyId?: string | null;
    messageId?: string | null;
    ruleId?: string | null;
    status?: string | null;
    triggerType?: string | null;
};

export type AutomodEventDocument = {
    actionType: AutomodActionType;
    authorUserId: string;
    channelId: string;
    createdAt: string;
    details: Record<string, unknown>;
    guildId: string;
    legacyId: string;
    messageId: string;
    ruleLegacyId?: string;
    status: string;
    triggerType: AutomodTriggerType;
};

export type AutomodEventRecord = {
    actionType: AutomodActionType;
    authorUserId: string;
    channelId: string;
    createdAt: string;
    details: Record<string, unknown>;
    guildId: string;
    id: string;
    messageId: string;
    ruleId: string | null;
    status: string;
    triggerType: AutomodTriggerType;
};

export type AutomodInputError =
    | { field: string; type: 'invalid-value' }
    | { field: string; type: 'missing-input' }
    | { type: 'invalid-config' };

export type AutomodInputResult<Value, ErrorValue> = { ok: true; value: Value } | { error: ErrorValue; ok: false };

export function buildAutomodRuleDocument(
    input: AutomodRuleInput,
    now: string,
    existing?: Pick<AutomodRuleDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): AutomodInputResult<AutomodRuleDocument, AutomodInputError> {
    const normalized = normalizeAutomodRuleInput(input);
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!normalized.ok) return normalized;

    if (!createdAt) {
        return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    }

    if (!updatedAt) {
        return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    }

    return {
        ok: true,
        value: {
            actionType: normalized.value.actionType,
            config: normalized.value.config,
            createdAt,
            enabled: normalized.value.enabled,
            guildId: normalized.value.guildId,
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            name: normalized.value.name,
            triggerType: normalized.value.triggerType,
            updatedAt,
        },
    };
}

export function normalizeAutomodRuleInput(input: AutomodRuleInput): AutomodInputResult<
    {
        actionType: AutomodActionType;
        config: AutomodRuleConfig;
        enabled: boolean;
        guildId: string;
        name: string;
        ruleId?: string;
        triggerType: AutomodTriggerType;
    },
    AutomodInputError
> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const ruleId = input.ruleId
        ? normalizeRequiredString(input.ruleId, 'ruleId')
        : { ok: true as const, value: undefined };
    const name = normalizeRequiredString(input.name, 'name');
    const triggerType = normalizeAutomodTriggerType(input.triggerType);
    const actionType = normalizeAutomodActionType(input.actionType ?? 'record');

    if (!guildId.ok) return guildId;
    if (!ruleId.ok) return ruleId;
    if (!name.ok) return name;
    if (!triggerType) return { error: { field: 'triggerType', type: 'invalid-value' }, ok: false };
    if (!actionType) return { error: { field: 'actionType', type: 'invalid-value' }, ok: false };

    const config = normalizeRuleConfig(triggerType, input.config ?? {});

    if (!config.ok) return config;

    return {
        ok: true,
        value: {
            actionType,
            config: config.value,
            enabled: input.enabled ?? true,
            guildId: guildId.value,
            name: name.value,
            ...(ruleId.value ? { ruleId: ruleId.value } : {}),
            triggerType,
        },
    };
}

export function buildAutomodEventDocument(
    input: AutomodEventInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): AutomodInputResult<AutomodEventDocument, AutomodInputError> {
    const normalized = normalizeAutomodEventInput(input);
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);

    if (!normalized.ok) return normalized;

    if (!createdAt) {
        return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    }

    return {
        ok: true,
        value: {
            ...normalized.value,
            createdAt,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
        },
    };
}

export function normalizeAutomodEventInput(input: AutomodEventInput): AutomodInputResult<
    {
        actionType: AutomodActionType;
        authorUserId: string;
        channelId: string;
        details: Record<string, unknown>;
        guildId: string;
        messageId: string;
        ruleLegacyId?: string;
        status: string;
        triggerType: AutomodTriggerType;
    },
    AutomodInputError
> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const ruleId = input.ruleId
        ? normalizeRequiredString(input.ruleId, 'ruleId')
        : { ok: true as const, value: undefined };
    const messageId = normalizeRequiredString(input.messageId, 'messageId');
    const channelId = normalizeRequiredString(input.channelId, 'channelId');
    const authorUserId = normalizeRequiredString(input.authorUserId, 'authorUserId');
    const triggerType = normalizeAutomodTriggerType(input.triggerType);
    const actionType = normalizeAutomodActionType(input.actionType ?? 'record');
    const status = normalizeOptionalString(input.status) ?? 'recorded';
    const details = normalizeRecord(input.details ?? {});

    if (!guildId.ok) return guildId;
    if (!ruleId.ok) return ruleId;
    if (!messageId.ok) return messageId;
    if (!channelId.ok) return channelId;
    if (!authorUserId.ok) return authorUserId;
    if (!triggerType) return { error: { field: 'triggerType', type: 'invalid-value' }, ok: false };
    if (!actionType) return { error: { field: 'actionType', type: 'invalid-value' }, ok: false };
    if (!details) return { error: { field: 'details', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            actionType,
            authorUserId: authorUserId.value,
            channelId: channelId.value,
            details,
            guildId: guildId.value,
            messageId: messageId.value,
            ...(ruleId.value ? { ruleLegacyId: ruleId.value } : {}),
            status,
            triggerType,
        },
    };
}

export function buildAutomodEventStatusPatch(
    input: { details?: Record<string, unknown> | null; status?: string | null },
    existingDetails: Record<string, unknown>
): AutomodInputResult<{ details: Record<string, unknown>; status: string }, AutomodInputError> {
    const status = normalizeRequiredString(input.status, 'status');
    const details = input.details === undefined ? existingDetails : normalizeRecord(input.details ?? {});

    if (!status.ok) return status;
    if (!details) return { error: { field: 'details', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            details,
            status: status.value,
        },
    };
}

export function normalizeRequiredGuildId(value: string): AutomodInputResult<string, AutomodInputError> {
    return normalizeRequiredString(value, 'guildId');
}

export function normalizeRequiredRuleId(value: string): AutomodInputResult<string, AutomodInputError> {
    return normalizeRequiredString(value, 'ruleId');
}

export function normalizeRequiredEventId(value: string): AutomodInputResult<string, AutomodInputError> {
    return normalizeRequiredString(value, 'eventId');
}

export function normalizeAutomodListLimit(limit: number | undefined): AutomodInputResult<number, AutomodInputError> {
    if (limit === undefined) {
        return { ok: true, value: 50 };
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return { error: { field: 'limit', type: 'invalid-value' }, ok: false };
    }

    return { ok: true, value: limit };
}

export function toAutomodRuleRecord(document: AutomodRuleDocument): AutomodRuleRecord {
    return {
        actionType: document.actionType,
        config: document.config,
        createdAt: document.createdAt,
        enabled: document.enabled,
        guildId: document.guildId,
        id: document.legacyId,
        name: document.name,
        triggerType: document.triggerType,
        updatedAt: document.updatedAt,
    };
}

export function toAutomodEventRecord(document: AutomodEventDocument): AutomodEventRecord {
    return {
        actionType: document.actionType,
        authorUserId: document.authorUserId,
        channelId: document.channelId,
        createdAt: document.createdAt,
        details: document.details,
        guildId: document.guildId,
        id: document.legacyId,
        messageId: document.messageId,
        ruleId: document.ruleLegacyId ?? null,
        status: document.status,
        triggerType: document.triggerType,
    };
}

function normalizeRuleConfig(
    triggerType: AutomodTriggerType,
    config: Record<string, unknown>
): AutomodInputResult<AutomodRuleConfig, AutomodInputError> {
    const timeoutDurationSeconds = normalizeTimeoutDurationSeconds(config.timeoutDurationSeconds);
    const ignoredChannelIds = normalizeTextArray(config.ignoredChannelIds);
    const ignoredRoleIds = normalizeTextArray(config.ignoredRoleIds);
    const ignoredUserIds = normalizeTextArray(config.ignoredUserIds);

    if (timeoutDurationSeconds === 'invalid') {
        return { error: { field: 'config.timeoutDurationSeconds', type: 'invalid-value' }, ok: false };
    }
    if (!ignoredChannelIds || !ignoredRoleIds || !ignoredUserIds) {
        return { error: { field: 'config.ignoredIds', type: 'invalid-value' }, ok: false };
    }

    const sharedConfig = {
        ...(timeoutDurationSeconds ? { timeoutDurationSeconds } : {}),
        ...(ignoredChannelIds.length > 0 ? { ignoredChannelIds } : {}),
        ...(ignoredRoleIds.length > 0 ? { ignoredRoleIds } : {}),
        ...(ignoredUserIds.length > 0 ? { ignoredUserIds } : {}),
    };

    if (triggerType === 'invite_links') {
        return { ok: true, value: sharedConfig };
    }

    const terms = normalizeTerms(config.terms);

    if (!terms || terms.length === 0) {
        return { error: { field: 'config.terms', type: 'invalid-value' }, ok: false };
    }

    return {
        ok: true,
        value: {
            terms,
            ...sharedConfig,
        },
    };
}

function normalizeTerms(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;

    return [
        ...new Set(
            value
                .filter((term): term is string => typeof term === 'string')
                .map(trim)
                .filter(Boolean)
        ),
    ];
}

function normalizeTextArray(value: unknown): string[] | undefined {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return undefined;

    return [
        ...new Set(
            value
                .filter((item): item is string => typeof item === 'string')
                .map(trim)
                .filter(Boolean)
        ),
    ];
}

function normalizeTimeoutDurationSeconds(value: unknown): number | undefined | 'invalid' {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'invalid';
    if (value < 60 || value > 2_419_200) return 'invalid';

    return value;
}

function normalizeRequiredString(
    value: string | null | undefined,
    field: string
): AutomodInputResult<string, AutomodInputError> {
    const normalizedValue = normalizeOptionalString(value);

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

    if (!Number.isFinite(parsed)) {
        return undefined;
    }

    return new Date(parsed).toISOString();
}

function normalizeAutomodTriggerType(value: string | null | undefined): AutomodTriggerType | undefined {
    return automodTriggerTypes.find((triggerType) => triggerType === value);
}

function normalizeAutomodActionType(value: string | null | undefined): AutomodActionType | undefined {
    return automodActionTypes.find((actionType) => actionType === value);
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
    return isRecord(value) ? value : undefined;
}

function trim(value: string): string {
    return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
