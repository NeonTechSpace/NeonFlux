export const serverLogEventGroups = ['channels', 'members', 'messages', 'moderation', 'roles', 'voice'] as const;

export type ServerLogEventGroup = (typeof serverLogEventGroups)[number];

export type GuildLoggingDestinationInput = {
    channelId?: string | null;
    createdAt?: string | null;
    enabled?: boolean | null;
    eventGroup?: string | null;
    guildId?: string | null;
    legacyId?: string | null;
    updatedAt?: string | null;
};

export type GuildLoggingDestinationDocument = {
    channelId: string;
    createdAt: string;
    enabled: boolean;
    eventGroup: ServerLogEventGroup;
    guildId: string;
    legacyId: string;
    updatedAt: string;
};

export type GuildLoggingDestinationRecord = {
    channelId: string;
    createdAt: string;
    enabled: boolean;
    eventGroup: ServerLogEventGroup;
    guildId: string;
    id: string;
    updatedAt: string;
};

export type LoggingDestinationInputError =
    | { field: 'channelId' | 'guildId'; type: 'missing-input' }
    | { field: 'createdAt' | 'updatedAt'; type: 'invalid-value' }
    | { field: 'eventGroup'; type: 'invalid-value' | 'missing-input' };

export type LoggingDestinationInputResult<Value, ErrorValue> =
    | { ok: true; value: Value }
    | { error: ErrorValue; ok: false };

export function buildGuildLoggingDestinationDocument(
    input: GuildLoggingDestinationInput,
    now: string,
    existing?: Pick<GuildLoggingDestinationDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): LoggingDestinationInputResult<GuildLoggingDestinationDocument, LoggingDestinationInputError> {
    const lookup = normalizeLoggingDestinationLookupInput(input);
    const channelId = normalizeRequiredString(input.channelId, 'channelId');
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!lookup.ok) {
        return lookup;
    }

    if (!channelId.ok) {
        return channelId;
    }

    if (!createdAt) {
        return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    }

    if (!updatedAt) {
        return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    }

    return {
        ok: true,
        value: {
            ...lookup.value,
            channelId: channelId.value,
            createdAt,
            enabled: input.enabled ?? true,
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            updatedAt,
        },
    };
}

export function normalizeLoggingDestinationLookupInput(input: {
    eventGroup?: string | null;
    guildId?: string | null;
}): LoggingDestinationInputResult<
    { eventGroup: ServerLogEventGroup; guildId: string },
    Extract<LoggingDestinationInputError, { field: 'eventGroup' | 'guildId' }>
> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');

    if (!guildId.ok) {
        return guildId;
    }

    const eventGroup = normalizeOptionalString(input.eventGroup);

    if (!eventGroup) {
        return { error: { field: 'eventGroup', type: 'missing-input' }, ok: false };
    }

    if (!isServerLogEventGroup(eventGroup)) {
        return { error: { field: 'eventGroup', type: 'invalid-value' }, ok: false };
    }

    return {
        ok: true,
        value: {
            eventGroup,
            guildId: guildId.value,
        },
    };
}

export function normalizeRequiredGuildId(
    value: string
): LoggingDestinationInputResult<string, Extract<LoggingDestinationInputError, { field: 'guildId' }>> {
    return normalizeRequiredString(value, 'guildId');
}

export function normalizeLoggingDestinationLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return 50;
    }

    return Math.min(Math.max(Math.trunc(limit), 1), 50);
}

export function toGuildLoggingDestinationRecord(
    document: GuildLoggingDestinationDocument
): GuildLoggingDestinationRecord {
    return {
        channelId: document.channelId,
        createdAt: document.createdAt,
        enabled: document.enabled,
        eventGroup: document.eventGroup,
        guildId: document.guildId,
        id: document.legacyId,
        updatedAt: document.updatedAt,
    };
}

export function isServerLogEventGroup(value: string): value is ServerLogEventGroup {
    return (serverLogEventGroups as readonly string[]).includes(value);
}

function normalizeRequiredString(
    value: string | null | undefined,
    field: 'channelId'
): LoggingDestinationInputResult<string, Extract<LoggingDestinationInputError, { field: 'channelId' }>>;
function normalizeRequiredString(
    value: string | null | undefined,
    field: 'guildId'
): LoggingDestinationInputResult<string, Extract<LoggingDestinationInputError, { field: 'guildId' }>>;
function normalizeRequiredString(
    value: string | null | undefined,
    field: 'channelId' | 'guildId'
): LoggingDestinationInputResult<string, Extract<LoggingDestinationInputError, { field: 'channelId' | 'guildId' }>> {
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
