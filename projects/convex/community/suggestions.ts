import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    buildSuggestionBoardDocument,
    buildSuggestionDocument,
    buildSuggestionVoteDocument,
    normalizeRequiredBoardName,
    normalizeRequiredGuildId,
    normalizeRequiredMessageId,
    normalizeRequiredSuggestionId,
    normalizeRequiredUserId,
    normalizeSuggestionLimit,
    toSuggestionBoardRecord,
    toSuggestionRecord,
    toSuggestionVoteRecord,
    type SuggestionBoardDocument,
    type SuggestionDocument,
    type SuggestionVoteDocument,
} from './suggestions_model.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
type SuggestionsQueryCtx = QueryCtx;
type SuggestionsMutationCtx = MutationCtx;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredSuggestionBoardDocument = SuggestionBoardDocument & { _id: GenericId<'suggestionBoards'> };
type StoredSuggestionDocument = SuggestionDocument & { _id: GenericId<'suggestions'> };
type StoredSuggestionVoteDocument = SuggestionVoteDocument & { _id: GenericId<'suggestionVotes'> };

const allowedSuggestionServices = ['bot', 'web'] as const;
const nullableString = v.union(v.string(), v.null());
const boardRecordValidator = v.object({
    channelId: v.string(),
    config: v.any(),
    createdAt: v.string(),
    enabled: v.boolean(),
    guildId: v.string(),
    id: v.string(),
    name: v.string(),
    updatedAt: v.string(),
});
const suggestionRecordValidator = v.object({
    authorUserId: v.string(),
    boardId: nullableString,
    channelId: nullableString,
    closedAt: nullableString,
    content: v.string(),
    createdAt: v.string(),
    guildId: v.string(),
    id: v.string(),
    messageId: nullableString,
    status: v.string(),
    updatedAt: v.string(),
});
const voteRecordValidator = v.object({
    createdAt: v.string(),
    id: v.string(),
    suggestionId: v.string(),
    updatedAt: v.string(),
    userId: v.string(),
    vote: v.union(v.literal('down'), v.literal('up')),
});

export const createSuggestionBoard = mutation({
    args: {
        channelId: v.string(),
        config: v.optional(v.any()),
        createdAt: v.optional(v.string()),
        guildId: v.string(),
        name: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: boardRecordValidator,
    handler: async (ctx: SuggestionsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedSuggestionServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        if (await findSuggestionBoardByGuildName(ctx, { guildId, name: args.name })) {
            throw new Error('suggestion-board-conflict');
        }

        const document = unwrap(buildSuggestionBoardDocument({ ...args, guildId }, new Date().toISOString()));

        const id = await ctx.db.insert('suggestionBoards', document);

        return toSuggestionBoardRecord({ ...document, _id: id });
    },
});

export const upsertSuggestionBoard = mutation({
    args: {
        channelId: v.string(),
        config: v.optional(v.any()),
        createdAt: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        guildId: v.string(),
        name: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: boardRecordValidator,
    handler: async (ctx: SuggestionsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedSuggestionServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existingBoard = await findSuggestionBoardByGuildName(ctx, { guildId, name: args.name });
        const document = unwrap(
            buildSuggestionBoardDocument({ ...args, guildId }, new Date().toISOString(), existingBoard ?? undefined)
        );

        if (existingBoard) {
            await ctx.db.patch(existingBoard._id, {
                channelId: document.channelId,
                config: document.config,
                enabled: document.enabled,
                updatedAt: document.updatedAt,
            });
            return toSuggestionBoardRecord({ ...existingBoard, ...document });
        } else {
            const id = await ctx.db.insert('suggestionBoards', document);
            return toSuggestionBoardRecord({ ...document, _id: id });
        }
    },
});

export const listSuggestionBoardsByGuildId = query({
    args: {
        enabledOnly: v.optional(v.boolean()),
        guildId: v.string(),
        limit: v.optional(v.number()),
    },
    returns: v.array(boardRecordValidator),
    handler: async (ctx: SuggestionsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedSuggestionServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const boards = args.enabledOnly
            ? await ctx.db
                  .query('suggestionBoards')
                  .withIndex('by_guild_enabled_name_created', (query) =>
                      query.eq('guildId', guildId).eq('enabled', true)
                  )
                  .order('asc')
                  .take(normalizeSuggestionLimit(args.limit))
            : await ctx.db
                  .query('suggestionBoards')
                  .withIndex('by_guild_name_created', (query) => query.eq('guildId', guildId))
                  .order('asc')
                  .take(normalizeSuggestionLimit(args.limit));

        return boards.map(toSuggestionBoardRecord);
    },
});

export const findDefaultSuggestionBoardByGuildId = query({
    args: { guildId: v.string() },
    returns: v.union(boardRecordValidator, v.null()),
    handler: async (ctx: SuggestionsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedSuggestionServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const boards = await ctx.db
            .query('suggestionBoards')
            .withIndex('by_guild_enabled_name_created', (query) => query.eq('guildId', guildId).eq('enabled', true))
            .order('asc')
            .take(1);

        return boards[0] ? toSuggestionBoardRecord(boards[0]) : null;
    },
});

export const deleteSuggestionBoard = mutation({
    args: { guildId: v.string(), name: v.string() },
    returns: v.union(boardRecordValidator, v.null()),
    handler: async (ctx: SuggestionsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedSuggestionServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const name = unwrap(normalizeRequiredBoardName(args.name));
        const board = await findSuggestionBoardByGuildName(ctx, { guildId, name });

        if (!board) return null;

        const suggestions = await ctx.db
            .query('suggestions')
            .withIndex('by_board_created', (query) => query.eq('boardId', board._id))
            .take(500);

        for (const suggestion of suggestions) {
            await ctx.db.patch(suggestion._id, { boardId: undefined });
        }

        await ctx.db.delete(board._id);

        return toSuggestionBoardRecord(board);
    },
});

export const createSuggestion = mutation({
    args: {
        authorUserId: v.string(),
        boardId: v.optional(v.string()),
        channelId: v.optional(v.string()),
        closedAt: v.optional(v.string()),
        content: v.string(),
        createdAt: v.optional(v.string()),
        guildId: v.string(),
        messageId: v.optional(v.string()),
        status: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    },
    returns: suggestionRecordValidator,
    handler: async (ctx: SuggestionsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedSuggestionServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);
        await requireBoardIfProvided(ctx, { boardId: args.boardId, guildId });

        const document = unwrap(buildSuggestionDocument({ ...args, guildId }, new Date().toISOString()));

        const id = await ctx.db.insert('suggestions', document);

        return toSuggestionRecord({ ...document, _id: id });
    },
});

export const findSuggestionByGuildMessageId = query({
    args: { guildId: v.string(), messageId: v.string() },
    returns: v.union(suggestionRecordValidator, v.null()),
    handler: async (ctx: SuggestionsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedSuggestionServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const suggestions = await ctx.db
            .query('suggestions')
            .withIndex('by_guild_message', (query) => query.eq('guildId', guildId).eq('messageId', messageId))
            .take(1);

        return suggestions[0] ? toSuggestionRecord(suggestions[0]) : null;
    },
});

export const upsertSuggestionVote = mutation({
    args: {
        createdAt: v.optional(v.string()),
        suggestionId: v.string(),
        updatedAt: v.optional(v.string()),
        userId: v.string(),
        vote: v.string(),
    },
    returns: voteRecordValidator,
    handler: async (ctx: SuggestionsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedSuggestionServices);
        const suggestionId = parseSuggestionId(unwrap(normalizeRequiredSuggestionId(args.suggestionId)));
        const userId = unwrap(normalizeRequiredUserId(args.userId));

        await requireSuggestion(ctx, suggestionId);

        const existingVote = await findSuggestionVoteDocument(ctx, { suggestionId, userId });
        const document = unwrap(
            buildSuggestionVoteDocument(
                {
                    ...args,
                    suggestionId,
                    userId,
                },
                new Date().toISOString(),
                existingVote ?? undefined
            )
        );

        if (existingVote) {
            await ctx.db.patch(existingVote._id, {
                updatedAt: document.updatedAt,
                vote: document.vote,
            });
            return toSuggestionVoteRecord({ ...existingVote, ...document });
        } else {
            const id = await ctx.db.insert('suggestionVotes', document);
            return toSuggestionVoteRecord({ ...document, _id: id });
        }
    },
});

export const deleteSuggestionVote = mutation({
    args: { suggestionId: v.string(), userId: v.string() },
    returns: v.union(voteRecordValidator, v.null()),
    handler: async (ctx: SuggestionsMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedSuggestionServices);
        const suggestionId = parseSuggestionId(unwrap(normalizeRequiredSuggestionId(args.suggestionId)));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const vote = await findSuggestionVoteDocument(ctx, { suggestionId, userId });

        if (!vote) return null;

        await ctx.db.delete(vote._id);

        return toSuggestionVoteRecord(vote);
    },
});

export const findSuggestionVote = query({
    args: { suggestionId: v.string(), userId: v.string() },
    returns: v.union(voteRecordValidator, v.null()),
    handler: async (ctx: SuggestionsQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedSuggestionServices);
        const suggestionId = parseSuggestionId(unwrap(normalizeRequiredSuggestionId(args.suggestionId)));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const vote = await findSuggestionVoteDocument(ctx, { suggestionId, userId });

        return vote ? toSuggestionVoteRecord(vote) : null;
    },
});

async function findSuggestionBoardByGuildName(
    ctx: SuggestionsQueryCtx | SuggestionsMutationCtx,
    input: { guildId: string; name: string }
): Promise<StoredSuggestionBoardDocument | null> {
    const name = unwrap(normalizeRequiredBoardName(input.name));

    return await ctx.db
        .query('suggestionBoards')
        .withIndex('by_guild_name', (query) => query.eq('guildId', input.guildId).eq('name', name))
        .unique();
}

async function findSuggestionBoardById(
    ctx: SuggestionsQueryCtx | SuggestionsMutationCtx,
    id: GenericId<'suggestionBoards'>
): Promise<StoredSuggestionBoardDocument | null> {
    return await ctx.db.get(id);
}

async function findSuggestionById(
    ctx: SuggestionsQueryCtx | SuggestionsMutationCtx,
    suggestionId: string
): Promise<StoredSuggestionDocument | null> {
    return await ctx.db.get(parseSuggestionId(suggestionId));
}

async function findSuggestionVoteDocument(
    ctx: SuggestionsQueryCtx | SuggestionsMutationCtx,
    input: { suggestionId: GenericId<'suggestions'>; userId: string }
): Promise<StoredSuggestionVoteDocument | null> {
    return await ctx.db
        .query('suggestionVotes')
        .withIndex('by_suggestion_user', (query) =>
            query.eq('suggestionId', input.suggestionId).eq('userId', input.userId)
        )
        .unique();
}

async function requireBoardIfProvided(
    ctx: SuggestionsMutationCtx,
    input: { boardId: string | undefined; guildId: string }
): Promise<void> {
    if (!input.boardId) return;

    const board = await findSuggestionBoardById(ctx, parseSuggestionBoardId(input.boardId));

    if (board?.guildId !== input.guildId) {
        throw new Error('suggestion-board-not-found');
    }
}

async function requireSuggestion(ctx: SuggestionsMutationCtx, suggestionId: string): Promise<StoredSuggestionDocument> {
    const suggestion = await findSuggestionById(ctx, suggestionId);

    if (!suggestion) throw new Error('suggestion-not-found');

    return suggestion;
}

function parseSuggestionBoardId(value: string): GenericId<'suggestionBoards'> {
    return value.trim() as GenericId<'suggestionBoards'>;
}

function parseSuggestionId(value: string): GenericId<'suggestions'> {
    return value.trim() as GenericId<'suggestions'>;
}

async function requireGuildDocument(ctx: SuggestionsMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) throw new Error('guild-not-found');

    return guild;
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) {
        const error = result.error;

        if (typeof error === 'object' && error !== null && 'type' in error) {
            throw new Error(String(error.type));
        }

        throw new Error(String(error));
    }

    return result.value;
}
