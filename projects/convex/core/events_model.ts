export type BotActionEventCursor = {
    createdAt: string;
    id: string;
};

export type BotActionEventSearchScope = 'actor' | 'all' | 'channel' | 'event' | 'message' | 'metadata' | 'time';

export type NormalizedBotActionEventSearch = {
    offsetMinutes?: number;
    scope: BotActionEventSearchScope;
    tokens: string[];
};

export type BotActionEventInput = {
    action?: string | null;
    actorUserId?: string | null;
    createdAt?: string | null;
    feature?: string | null;
    guildId?: string | null;
    legacyId?: string | null;
    metadata?: unknown;
    targetId?: string | null;
};

export type BotActionEventDocument = {
    action: string;
    actorUserId?: string;
    createdAt: string;
    feature: string;
    guildId?: string;
    legacyId: string;
    metadata: Record<string, unknown>;
    targetId?: string;
};

export type BotActionEventRecord = {
    action: string;
    actorUserId: string | null;
    createdAt: string;
    feature: string;
    guildId: string | null;
    id: string;
    metadata: Record<string, unknown>;
    targetId: string | null;
};

export type BotActionEventInputError =
    | 'invalid-created-at'
    | 'invalid-cursor'
    | 'invalid-metadata'
    | 'missing-action'
    | 'missing-feature'
    | 'missing-guild-id';

export type EventInputResult<Value, ErrorValue extends string> =
    | { ok: true; value: Value }
    | { error: ErrorValue; ok: false };

export function buildBotActionEventDocument(
    input: BotActionEventInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): EventInputResult<BotActionEventDocument, BotActionEventInputError> {
    const feature = normalizeOptionalString(input.feature);
    const action = normalizeOptionalString(input.action);
    const createdAt = normalizeTimestamp(input.createdAt ?? now);
    const metadata = normalizeMetadata(input.metadata);

    if (!feature) {
        return { error: 'missing-feature', ok: false };
    }

    if (!action) {
        return { error: 'missing-action', ok: false };
    }

    if (!createdAt) {
        return { error: 'invalid-created-at', ok: false };
    }

    if (!metadata.ok) {
        return metadata;
    }

    const guildId = normalizeOptionalString(input.guildId);
    const actorUserId = normalizeOptionalString(input.actorUserId);
    const targetId = normalizeOptionalString(input.targetId);
    const legacyId = normalizeOptionalString(input.legacyId) ?? createLegacyId();

    return {
        ok: true,
        value: {
            ...(actorUserId ? { actorUserId } : {}),
            ...(guildId ? { guildId } : {}),
            ...(targetId ? { targetId } : {}),
            action,
            createdAt,
            feature,
            legacyId,
            metadata: metadata.value,
        },
    };
}

export function normalizeRequiredGuildId(
    value: string
): EventInputResult<string, Extract<BotActionEventInputError, 'missing-guild-id'>> {
    const normalizedValue = normalizeOptionalString(value);

    return normalizedValue ? { ok: true, value: normalizedValue } : { error: 'missing-guild-id', ok: false };
}

export function normalizeBotActionEventCursor(
    cursor: BotActionEventCursor | undefined
): EventInputResult<BotActionEventCursor | undefined, Extract<BotActionEventInputError, 'invalid-cursor'>> {
    if (!cursor) {
        return { ok: true, value: undefined };
    }

    const createdAt = normalizeTimestamp(cursor.createdAt);
    const id = normalizeOptionalString(cursor.id);

    if (!createdAt || !id) {
        return { error: 'invalid-cursor', ok: false };
    }

    return {
        ok: true,
        value: {
            createdAt,
            id,
        },
    };
}

export function normalizeBotActionEventLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return 25;
    }

    return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

export function normalizeBotActionEventSearch(input: {
    search?: string;
    searchOffsetMinutes?: number;
    searchScope?: string;
}): NormalizedBotActionEventSearch {
    const offsetMinutes = normalizeSearchOffsetMinutes(input.searchOffsetMinutes);

    return {
        ...(offsetMinutes === undefined ? {} : { offsetMinutes }),
        scope: normalizeSearchScope(input.searchScope),
        tokens:
            input.search
                ?.trim()
                .toLowerCase()
                .split(/\s+/u)
                .map((token) => normalizeSearchText(token))
                .filter(Boolean)
                .slice(0, 8) ?? [],
    };
}

export function botActionEventMatchesSearch(
    document: BotActionEventDocument,
    search: NormalizedBotActionEventSearch
): boolean {
    if (search.tokens.length === 0) {
        return true;
    }

    const normalizedFields = getBotActionEventSearchFields(document, search).map(normalizeSearchText).filter(Boolean);

    return search.tokens.every((token) => normalizedFields.some((field) => field.includes(token)));
}

export function toBotActionEventRecord(document: BotActionEventDocument): BotActionEventRecord {
    return {
        action: document.action,
        actorUserId: document.actorUserId ?? null,
        createdAt: document.createdAt,
        feature: document.feature,
        guildId: document.guildId ?? null,
        id: document.legacyId,
        metadata: document.metadata,
        targetId: document.targetId ?? null,
    };
}

export function toBotActionEventCursor(record: BotActionEventRecord): BotActionEventCursor {
    return {
        createdAt: record.createdAt,
        id: record.id,
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

function normalizeMetadata(
    value: unknown
): EventInputResult<Record<string, unknown>, Extract<BotActionEventInputError, 'invalid-metadata'>> {
    if (value === undefined) {
        return { ok: true, value: {} };
    }

    if (isPlainRecord(value)) {
        return { ok: true, value };
    }

    return { error: 'invalid-metadata', ok: false };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSearchScope(scope: string | undefined): BotActionEventSearchScope {
    switch (scope) {
        case 'actor':
        case 'channel':
        case 'event':
        case 'message':
        case 'metadata':
        case 'time':
            return scope;

        case 'all':
        case undefined:
        default:
            return 'all';
    }
}

function normalizeSearchOffsetMinutes(offsetMinutes: number | undefined): number | undefined {
    if (offsetMinutes === undefined || !Number.isFinite(offsetMinutes)) {
        return undefined;
    }

    return Math.min(Math.max(Math.trunc(offsetMinutes), -1440), 1440);
}

function getBotActionEventSearchFields(
    document: BotActionEventDocument,
    search: NormalizedBotActionEventSearch
): string[] {
    const eventFields = [document.feature, document.action];
    const actorFields = [
        document.actorUserId,
        readMetadataScalar(document.metadata, 'actorUsername'),
        readMetadataScalar(document.metadata, 'actorDisplayName'),
        readMetadataScalar(document.metadata, 'actorGlobalName'),
    ];
    const channelFields = [
        readMetadataScalar(document.metadata, 'channelName'),
        readMetadataScalar(document.metadata, 'channelId'),
    ];
    const messageFields = [document.targetId, readMetadataScalar(document.metadata, 'messageId')];
    const timeFields = [
        document.createdAt,
        ...formatSearchDates(document.createdAt),
        ...(search.offsetMinutes === undefined
            ? []
            : formatSearchDates(applyOffsetMinutes(document.createdAt, search.offsetMinutes))),
    ];
    const metadataFields = [JSON.stringify(document.metadata)];

    switch (search.scope) {
        case 'actor':
            return compactStrings(actorFields);

        case 'channel':
            return compactStrings(channelFields);

        case 'event':
            return compactStrings(eventFields);

        case 'message':
            return compactStrings(messageFields);

        case 'metadata':
            return compactStrings(metadataFields);

        case 'time':
            return compactStrings(timeFields);

        case 'all':
            return compactStrings([
                ...eventFields,
                ...actorFields,
                ...channelFields,
                ...messageFields,
                ...timeFields,
                ...metadataFields,
            ]);
    }
}

function readMetadataScalar(metadata: Record<string, unknown>, key: string): string | undefined {
    const value = metadata[key];

    switch (typeof value) {
        case 'bigint':
        case 'boolean':
        case 'number':
        case 'string':
            return String(value);

        default:
            return undefined;
    }
}

function formatSearchDates(value: string): string[] {
    const parsed = Date.parse(value);

    if (!Number.isFinite(parsed)) {
        return [];
    }

    const date = new Date(parsed);
    const year = String(date.getUTCFullYear()).padStart(4, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour24 = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    const second = String(date.getUTCSeconds()).padStart(2, '0');
    const hour12Value = date.getUTCHours() % 12 || 12;
    const hour12 = String(hour12Value).padStart(2, '0');
    const amPm = date.getUTCHours() < 12 ? 'AM' : 'PM';

    return [
        date.toISOString(),
        `${year}-${month}-${day} ${hour24}:${minute}:${second} ${amPm}`,
        `${month}/${day}/${year} ${hour12}:${minute}:${second} ${amPm}`,
    ];
}

function applyOffsetMinutes(value: string, offsetMinutes: number): string {
    return new Date(Date.parse(value) - offsetMinutes * 60_000).toISOString();
}

function normalizeSearchText(value: string | undefined): string {
    return value?.toLowerCase().replace(/[^a-z0-9]+/gu, '') ?? '';
}

function compactStrings(values: readonly (string | undefined)[]): string[] {
    return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}
