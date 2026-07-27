export type BotActionEventCursor = string;

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
    metadata?: unknown;
    targetId?: string | null;
};

export type BotActionEventDocument = {
    action: string;
    actorUserId?: string;
    createdAt: string;
    feature: string;
    guildId?: string;
    metadata: Record<string, unknown>;
    sortKey?: string;
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
    | 'invalid-action'
    | 'invalid-created-at'
    | 'invalid-cursor'
    | 'invalid-feature'
    | 'invalid-identifier'
    | 'invalid-metadata'
    | 'missing-action'
    | 'missing-feature'
    | 'missing-guild-id';

type BotActionEventLegacyCursor = {
    createdAt: string;
    id: string;
};

type BotActionEventOpaqueCursorPayload = {
    k: string;
    v: 1;
};

const botActionEventIdentifierMaxLength = 256;
const botActionEventTypeMaxLength = 128;
const botActionEventMetadataKeyMaxLength = 64;
const botActionEventMetadataStringMaxLength = 1_000;
const botActionEventMetadataMaxKeys = 32;
const botActionEventMetadataMaxBytes = 8_192;
const botActionEventCursorMaxLength = 1_024;

export type EventInputResult<Value, ErrorValue extends string> =
    | { ok: true; value: Value }
    | { error: ErrorValue; ok: false };

export function buildBotActionEventDocument(
    input: BotActionEventInput,
    now: string
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

    if (feature.length > botActionEventTypeMaxLength) {
        return { error: 'invalid-feature', ok: false };
    }

    if (action.length > botActionEventTypeMaxLength) {
        return { error: 'invalid-action', ok: false };
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

    if ([guildId, actorUserId, targetId].some((value) => value && value.length > botActionEventIdentifierMaxLength)) {
        return { error: 'invalid-identifier', ok: false };
    }

    return {
        ok: true,
        value: {
            ...(actorUserId ? { actorUserId } : {}),
            ...(guildId ? { guildId } : {}),
            ...(targetId ? { targetId } : {}),
            action,
            createdAt,
            feature,
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

    const normalizedCursor = normalizeOptionalString(cursor);

    if (!normalizedCursor || normalizedCursor.length > botActionEventCursorMaxLength) {
        return { error: 'invalid-cursor', ok: false };
    }

    return {
        ok: true,
        value: normalizedCursor,
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

export function toBotActionEventRecord(document: BotActionEventDocument & { _id: string }): BotActionEventRecord {
    return {
        action: document.action,
        actorUserId: document.actorUserId ?? null,
        createdAt: document.createdAt,
        feature: document.feature,
        guildId: document.guildId ?? null,
        id: document._id,
        metadata: document.metadata,
        targetId: document.targetId ?? null,
    };
}

export function buildBotActionEventSortKey(input: { createdAt: string; id: string }): string {
    return `${input.createdAt}|${input.id}`;
}

export function encodeBotActionEventCursor(sortKey: string): BotActionEventCursor {
    return encodeBase64Url(JSON.stringify({ k: sortKey, v: 1 } satisfies BotActionEventOpaqueCursorPayload));
}

export function decodeBotActionEventCursor(
    cursor: BotActionEventCursor
): EventInputResult<
    { legacy?: BotActionEventLegacyCursor; sortKey?: string },
    Extract<BotActionEventInputError, 'invalid-cursor'>
> {
    const normalizedCursor = normalizeOptionalString(cursor);

    if (!normalizedCursor || normalizedCursor.length > botActionEventCursorMaxLength) {
        return { error: 'invalid-cursor', ok: false };
    }

    const opaqueCursor = decodeOpaqueBotActionEventCursor(normalizedCursor);
    if (opaqueCursor.ok) {
        return opaqueCursor;
    }

    const legacyCursor = decodeLegacyBotActionEventCursor(normalizedCursor);
    if (legacyCursor.ok) {
        return legacyCursor;
    }

    return { error: 'invalid-cursor', ok: false };
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function decodeOpaqueBotActionEventCursor(
    cursor: string
): EventInputResult<{ sortKey: string }, Extract<BotActionEventInputError, 'invalid-cursor'>> {
    let payload: unknown;

    try {
        payload = JSON.parse(decodeBase64Url(cursor)) as unknown;
    } catch {
        return { error: 'invalid-cursor', ok: false };
    }

    if (!isPlainRecord(payload) || payload.v !== 1) {
        return { error: 'invalid-cursor', ok: false };
    }

    const sortKey = normalizeOptionalString(payload.k as string | undefined);

    return sortKey ? { ok: true, value: { sortKey } } : { error: 'invalid-cursor', ok: false };
}

function decodeLegacyBotActionEventCursor(
    cursor: string
): EventInputResult<{ legacy: BotActionEventLegacyCursor }, Extract<BotActionEventInputError, 'invalid-cursor'>> {
    const [createdAtValue, id, ...extraParts] = cursor.split('|');
    const createdAt = normalizeTimestamp(createdAtValue);
    const normalizedId = normalizeOptionalString(id);

    if (!createdAt || !normalizedId || extraParts.length > 0) {
        return { error: 'invalid-cursor', ok: false };
    }

    return {
        ok: true,
        value: {
            legacy: {
                createdAt,
                id: normalizedId,
            },
        },
    };
}

function encodeBase64Url(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64Url(value: string): string {
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
        throw new Error('invalid-base64url');
    }

    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(paddedBase64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new TextDecoder().decode(bytes);
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

    if (!isPlainRecord(value)) {
        return { error: 'invalid-metadata', ok: false };
    }

    const entries = Object.entries(value).filter((entry): entry is [string, Exclude<unknown, undefined>] => {
        return entry[1] !== undefined;
    });

    if (entries.length > botActionEventMetadataMaxKeys) {
        return { error: 'invalid-metadata', ok: false };
    }

    const metadata: Record<string, boolean | number | string | null> = {};

    for (const [key, entry] of entries) {
        if (
            key.length === 0 ||
            key !== key.trim() ||
            key.length > botActionEventMetadataKeyMaxLength ||
            !isBotActionEventMetadataScalar(entry) ||
            (typeof entry === 'string' && entry.length > botActionEventMetadataStringMaxLength)
        ) {
            return { error: 'invalid-metadata', ok: false };
        }

        metadata[key] = entry;
    }

    if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > botActionEventMetadataMaxBytes) {
        return { error: 'invalid-metadata', ok: false };
    }

    return { ok: true, value: metadata };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isBotActionEventMetadataScalar(value: unknown): value is boolean | number | string | null {
    return (
        value === null ||
        typeof value === 'boolean' ||
        typeof value === 'string' ||
        (typeof value === 'number' && Number.isFinite(value))
    );
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

        case 'function':
        case 'object':
        case 'symbol':
        case 'undefined':
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

function compactStrings(values: ReadonlyArray<string | undefined>): string[] {
    return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}
