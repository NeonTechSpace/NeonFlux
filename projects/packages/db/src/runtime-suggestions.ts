import { api } from '@neonflux/convex-api';
import { err, ok, type Result } from 'neverthrow';

import type {
    GuildFeatureRepositoryError,
    SuggestionBoardRecord,
    SuggestionRecord,
    SuggestionsRepositoryError,
    SuggestionVoteRecord,
} from './contracts.js';

import type { ConvexDatabase } from './convex.js';

type SuggestionsDb = ConvexDatabase;

type ConvexSuggestionBoardRecord = {
    channelId: string;
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    guildId: string;
    id: string;
    name: string;
    updatedAt: string;
};

type ConvexSuggestionRecord = {
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

type ConvexSuggestionVoteRecord = {
    createdAt: string;
    id: string;
    suggestionId: string;
    updatedAt: string;
    userId: string;
    vote: 'down' | 'up';
};

export async function createSuggestionBoard(
    db: SuggestionsDb,
    input: { channelId: string; config?: Record<string, unknown>; guildId: string; name: string }
): Promise<Result<SuggestionBoardRecord, SuggestionsRepositoryError>> {
    const normalizedInput = normalizeSuggestionBoardInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const board = await db.client.mutation(
            api.suggestions.createSuggestionBoard,
            normalizedInput.value
        );

        return ok(toSuggestionBoardRecord(board));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertSuggestionBoard(
    db: SuggestionsDb,
    input: { channelId: string; config?: Record<string, unknown>; enabled?: boolean; guildId: string; name: string }
): Promise<Result<SuggestionBoardRecord, SuggestionsRepositoryError>> {
    const normalizedInput = normalizeSuggestionBoardInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const board = await db.client.mutation(api.suggestions.upsertSuggestionBoard, {
            ...normalizedInput.value,
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        });

        return ok(toSuggestionBoardRecord(board));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listSuggestionBoardsByGuildId(
    db: SuggestionsDb,
    input: { enabledOnly?: boolean; guildId: string }
): Promise<Result<SuggestionBoardRecord[], SuggestionsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const boards = await db.client.query(
            api.suggestions.listSuggestionBoardsByGuildId,
            {
                ...(input.enabledOnly === undefined ? {} : { enabledOnly: input.enabledOnly }),
                guildId: guildId.value,
            }
        );

        return ok(boards.map(toSuggestionBoardRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findDefaultSuggestionBoardByGuildId(
    db: SuggestionsDb,
    input: { guildId: string }
): Promise<Result<SuggestionBoardRecord, SuggestionsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const board = await db.client.query(
            api.suggestions.findDefaultSuggestionBoardByGuildId,
            {
                guildId: guildId.value,
            }
        );

        return board ? ok(toSuggestionBoardRecord(board)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteSuggestionBoard(
    db: SuggestionsDb,
    input: { guildId: string; name: string }
): Promise<Result<SuggestionBoardRecord, SuggestionsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeRequiredText(input.name, 'name');

    if (guildId.isErr()) return err(guildId.error);
    if (name.isErr()) return err(name.error);

    try {
        const board = await db.client.mutation(
            api.suggestions.deleteSuggestionBoard,
            {
                guildId: guildId.value,
                name: name.value,
            }
        );

        return board ? ok(toSuggestionBoardRecord(board)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createSuggestion(
    db: SuggestionsDb,
    input: {
        authorUserId: string;
        boardId?: string;
        channelId?: string;
        content: string;
        guildId: string;
        messageId?: string;
    }
): Promise<Result<SuggestionRecord, SuggestionsRepositoryError>> {
    const normalizedInput = normalizeSuggestionInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const suggestion = await db.client.mutation(
            api.suggestions.createSuggestion,
            normalizedInput.value
        );

        return ok(toSuggestionRecord(suggestion));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findSuggestionByGuildMessageId(
    db: SuggestionsDb,
    input: { guildId: string; messageId: string }
): Promise<Result<SuggestionRecord, SuggestionsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);

    try {
        const suggestion = await db.client.query(
            api.suggestions.findSuggestionByGuildMessageId,
            {
                guildId: guildId.value,
                messageId: messageId.value,
            }
        );

        return suggestion ? ok(toSuggestionRecord(suggestion)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertSuggestionVote(
    db: SuggestionsDb,
    input: { suggestionId: string; userId: string; vote: string }
): Promise<Result<SuggestionVoteRecord, SuggestionsRepositoryError>> {
    const normalizedInput = normalizeSuggestionVoteInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const vote = await db.client.mutation(
            api.suggestions.upsertSuggestionVote,
            normalizedInput.value
        );

        return ok(toSuggestionVoteRecord(vote));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteSuggestionVote(
    db: SuggestionsDb,
    input: { suggestionId: string; userId: string }
): Promise<Result<SuggestionVoteRecord, SuggestionsRepositoryError>> {
    const normalizedInput = normalizeSuggestionVoteLookupInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const vote = await db.client.mutation(
            api.suggestions.deleteSuggestionVote,
            normalizedInput.value
        );

        return vote ? ok(toSuggestionVoteRecord(vote)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findSuggestionVote(
    db: SuggestionsDb,
    input: { suggestionId: string; userId: string }
): Promise<Result<SuggestionVoteRecord, SuggestionsRepositoryError>> {
    const normalizedInput = normalizeSuggestionVoteLookupInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const vote = await db.client.query(
            api.suggestions.findSuggestionVote,
            normalizedInput.value
        );

        return vote ? ok(toSuggestionVoteRecord(vote)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

function toSuggestionBoardRecord(record: ConvexSuggestionBoardRecord): SuggestionBoardRecord {
    return {
        channelId: record.channelId,
        config: record.config,
        createdAt: new Date(record.createdAt),
        enabled: record.enabled,
        guildId: record.guildId,
        id: record.id,
        name: record.name,
        updatedAt: new Date(record.updatedAt),
    };
}

function toSuggestionRecord(record: ConvexSuggestionRecord): SuggestionRecord {
    return {
        authorUserId: record.authorUserId,
        boardId: record.boardId,
        channelId: record.channelId,
        closedAt: record.closedAt ? new Date(record.closedAt) : null,
        content: record.content,
        createdAt: new Date(record.createdAt),
        guildId: record.guildId,
        id: record.id,
        messageId: record.messageId,
        status: record.status,
        updatedAt: new Date(record.updatedAt),
    };
}

function toSuggestionVoteRecord(record: ConvexSuggestionVoteRecord): SuggestionVoteRecord {
    return {
        createdAt: new Date(record.createdAt),
        id: record.id,
        suggestionId: record.suggestionId,
        updatedAt: new Date(record.updatedAt),
        userId: record.userId,
        vote: record.vote,
    };
}

function normalizeSuggestionBoardInput(input: {
    channelId: string;
    config?: Record<string, unknown>;
    guildId: string;
    name: string;
}): Result<
    { channelId: string; config?: Record<string, unknown>; guildId: string; name: string },
    SuggestionsRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const name = normalizeRequiredText(input.name, 'name');

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (name.isErr()) return err(name.error);

    return ok({
        channelId: channelId.value,
        ...(input.config === undefined ? {} : { config: input.config }),
        guildId: guildId.value,
        name: name.value,
    });
}

function normalizeSuggestionInput(input: {
    authorUserId: string;
    boardId?: string;
    channelId?: string;
    content: string;
    guildId: string;
    messageId?: string;
}): Result<
    {
        authorUserId: string;
        boardId?: string;
        channelId?: string;
        content: string;
        guildId: string;
        messageId?: string;
    },
    SuggestionsRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const authorUserId = normalizeRequiredText(input.authorUserId, 'authorUserId');
    const content = normalizeRequiredText(input.content, 'content');
    const boardId = normalizeOptionalText(input.boardId);
    const channelId = normalizeOptionalText(input.channelId);
    const messageId = normalizeOptionalText(input.messageId);

    if (guildId.isErr()) return err(guildId.error);
    if (authorUserId.isErr()) return err(authorUserId.error);
    if (content.isErr()) return err(content.error);

    return ok({
        authorUserId: authorUserId.value,
        ...(boardId ? { boardId } : {}),
        ...(channelId ? { channelId } : {}),
        content: content.value,
        guildId: guildId.value,
        ...(messageId ? { messageId } : {}),
    });
}

function normalizeSuggestionVoteInput(input: {
    suggestionId: string;
    userId: string;
    vote: string;
}): Result<{ suggestionId: string; userId: string; vote: 'down' | 'up' }, SuggestionsRepositoryError> {
    const suggestionId = normalizeRequiredText(input.suggestionId, 'suggestionId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const vote = normalizeRequiredText(input.vote, 'vote');

    if (suggestionId.isErr()) return err(suggestionId.error);
    if (userId.isErr()) return err(userId.error);
    if (vote.isErr()) return err(vote.error);
    if (!isSuggestionVote(vote.value)) return err({ field: 'vote', type: 'invalid-value' });

    return ok({
        suggestionId: suggestionId.value,
        userId: userId.value,
        vote: vote.value,
    });
}

function normalizeSuggestionVoteLookupInput(input: {
    suggestionId: string;
    userId: string;
}): Result<{ suggestionId: string; userId: string }, SuggestionsRepositoryError> {
    const suggestionId = normalizeRequiredText(input.suggestionId, 'suggestionId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (suggestionId.isErr()) return err(suggestionId.error);
    if (userId.isErr()) return err(userId.error);

    return ok({
        suggestionId: suggestionId.value,
        userId: userId.value,
    });
}

function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    if (!normalizedValue) {
        return err({ field, type: 'missing-input' });
    }

    return ok(normalizedValue);
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function isSuggestionVote(vote: string): vote is 'down' | 'up' {
    return vote === 'up' || vote === 'down';
}
