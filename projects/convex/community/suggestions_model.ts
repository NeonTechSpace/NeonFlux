export type SuggestionBoardInput = {
    channelId?: string | null;
    config?: Record<string, unknown> | null;
    createdAt?: string | null;
    enabled?: boolean | null;
    guildId?: string | null;
    legacyId?: string | null;
    name?: string | null;
    updatedAt?: string | null;
};

export type SuggestionBoardDocument = {
    channelId: string;
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    guildId: string;
    legacyId: string;
    name: string;
    updatedAt: string;
};

export type SuggestionBoardRecord = {
    channelId: string;
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    guildId: string;
    id: string;
    name: string;
    updatedAt: string;
};

export type SuggestionInput = {
    authorUserId?: string | null;
    boardId?: string | null;
    channelId?: string | null;
    closedAt?: string | null;
    content?: string | null;
    createdAt?: string | null;
    guildId?: string | null;
    legacyId?: string | null;
    messageId?: string | null;
    status?: string | null;
    updatedAt?: string | null;
};

export type SuggestionDocument = {
    authorUserId: string;
    boardLegacyId?: string;
    channelId?: string;
    closedAt?: string;
    content: string;
    createdAt: string;
    guildId: string;
    legacyId: string;
    messageId?: string;
    status: string;
    updatedAt: string;
};

export type SuggestionRecord = {
    authorUserId: string;
    boardId: string | null;
    channelId: string | null;
    closedAt: string | null;
    content: string;
    createdAt: string;
    guildId: string;
    id: string;
    messageId: string | null;
    status: string;
    updatedAt: string;
};

export type SuggestionVoteInput = {
    createdAt?: string | null;
    legacyId?: string | null;
    suggestionId?: string | null;
    updatedAt?: string | null;
    userId?: string | null;
    vote?: string | null;
};

export type SuggestionVoteDocument = {
    createdAt: string;
    legacyId: string;
    suggestionLegacyId: string;
    updatedAt: string;
    userId: string;
    vote: 'down' | 'up';
};

export type SuggestionVoteRecord = {
    createdAt: string;
    id: string;
    suggestionId: string;
    updatedAt: string;
    userId: string;
    vote: 'down' | 'up';
};

export type SuggestionsInputError = { field: string; type: 'invalid-value' | 'missing-input' };
export type SuggestionsInputResult<Value> = { ok: true; value: Value } | { error: SuggestionsInputError; ok: false };

export function buildSuggestionBoardDocument(
    input: SuggestionBoardInput,
    now: string,
    existing?: Pick<SuggestionBoardDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): SuggestionsInputResult<SuggestionBoardDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const channelId = normalizeRequiredString(input.channelId, 'channelId');
    const name = normalizeRequiredString(input.name, 'name');
    const config = normalizeRecord(input.config ?? {});
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) return guildId;
    if (!channelId.ok) return channelId;
    if (!name.ok) return name;
    if (!config) return { error: { field: 'config', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            channelId: channelId.value,
            config,
            createdAt,
            enabled: input.enabled ?? true,
            guildId: guildId.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            name: name.value,
            updatedAt,
        },
    };
}

export function buildSuggestionDocument(
    input: SuggestionInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): SuggestionsInputResult<SuggestionDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const authorUserId = normalizeRequiredString(input.authorUserId, 'authorUserId');
    const content = normalizeRequiredString(input.content, 'content');
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);
    const closedAt =
        input.closedAt === undefined || input.closedAt === null ? undefined : normalizeTimestamp(input.closedAt);

    if (!guildId.ok) return guildId;
    if (!authorUserId.ok) return authorUserId;
    if (!content.ok) return content;
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    if (input.closedAt !== undefined && input.closedAt !== null && !closedAt) {
        return { error: { field: 'closedAt', type: 'invalid-value' }, ok: false };
    }

    const boardLegacyId = normalizeOptionalString(input.boardId);
    const channelId = normalizeOptionalString(input.channelId);
    const messageId = normalizeOptionalString(input.messageId);

    return {
        ok: true,
        value: {
            authorUserId: authorUserId.value,
            ...(boardLegacyId ? { boardLegacyId } : {}),
            ...(channelId ? { channelId } : {}),
            ...(closedAt ? { closedAt } : {}),
            content: content.value,
            createdAt,
            guildId: guildId.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
            ...(messageId ? { messageId } : {}),
            status: normalizeOptionalString(input.status) ?? 'open',
            updatedAt,
        },
    };
}

export function buildSuggestionVoteDocument(
    input: SuggestionVoteInput,
    now: string,
    existing?: Pick<SuggestionVoteDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): SuggestionsInputResult<SuggestionVoteDocument> {
    const suggestionId = normalizeRequiredString(input.suggestionId, 'suggestionId');
    const userId = normalizeRequiredString(input.userId, 'userId');
    const vote = normalizeVote(input.vote);
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!suggestionId.ok) return suggestionId;
    if (!userId.ok) return userId;
    if (!vote.ok) return vote;
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            createdAt,
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            suggestionLegacyId: suggestionId.value,
            updatedAt,
            userId: userId.value,
            vote: vote.value,
        },
    };
}

export function normalizeRequiredGuildId(value: string): SuggestionsInputResult<string> {
    return normalizeRequiredString(value, 'guildId');
}

export function normalizeRequiredBoardName(value: string): SuggestionsInputResult<string> {
    return normalizeRequiredString(value, 'name');
}

export function normalizeRequiredMessageId(value: string): SuggestionsInputResult<string> {
    return normalizeRequiredString(value, 'messageId');
}

export function normalizeRequiredSuggestionId(value: string): SuggestionsInputResult<string> {
    return normalizeRequiredString(value, 'suggestionId');
}

export function normalizeRequiredUserId(value: string): SuggestionsInputResult<string> {
    return normalizeRequiredString(value, 'userId');
}

export function normalizeSuggestionLimit(limit: number | undefined, fallback = 100): number {
    if (limit === undefined || !Number.isFinite(limit)) return fallback;

    return Math.min(Math.max(Math.trunc(limit), 1), 500);
}

export function toSuggestionBoardRecord(document: SuggestionBoardDocument): SuggestionBoardRecord {
    return {
        channelId: document.channelId,
        config: document.config,
        createdAt: document.createdAt,
        enabled: document.enabled,
        guildId: document.guildId,
        id: document.legacyId,
        name: document.name,
        updatedAt: document.updatedAt,
    };
}

export function toSuggestionRecord(document: SuggestionDocument): SuggestionRecord {
    return {
        authorUserId: document.authorUserId,
        boardId: document.boardLegacyId ?? null,
        channelId: document.channelId ?? null,
        closedAt: document.closedAt ?? null,
        content: document.content,
        createdAt: document.createdAt,
        guildId: document.guildId,
        id: document.legacyId,
        messageId: document.messageId ?? null,
        status: document.status,
        updatedAt: document.updatedAt,
    };
}

export function toSuggestionVoteRecord(document: SuggestionVoteDocument): SuggestionVoteRecord {
    return {
        createdAt: document.createdAt,
        id: document.legacyId,
        suggestionId: document.suggestionLegacyId,
        updatedAt: document.updatedAt,
        userId: document.userId,
        vote: document.vote,
    };
}

function normalizeRequiredString(value: string | null | undefined, field: string): SuggestionsInputResult<string> {
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

    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function normalizeRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function normalizeVote(value: string | null | undefined): SuggestionsInputResult<'down' | 'up'> {
    const normalizedValue = normalizeOptionalString(value);

    if (normalizedValue === 'down' || normalizedValue === 'up') {
        return { ok: true, value: normalizedValue };
    }

    return { error: { field: 'vote', type: normalizedValue ? 'invalid-value' : 'missing-input' }, ok: false };
}
