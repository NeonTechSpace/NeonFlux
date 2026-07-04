import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    createSuggestion,
    createSuggestionBoard,
    deleteSuggestionBoard,
    deleteSuggestionVote,
    findDefaultSuggestionBoardByGuildId,
    findSuggestionByGuildMessageId,
    findSuggestionVote,
    listSuggestionBoardsByGuildId,
    upsertSuggestionBoard,
    upsertSuggestionVote,
} from './runtime-suggestions.js';

const suggestionBoard = {
    channelId: 'channel-1',
    config: { allowAnonymous: false },
    createdAt: '2026-07-03T08:00:00.000Z',
    enabled: true,
    guildId: 'guild-1',
    id: 'board-1',
    name: 'ideas',
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const suggestion = {
    authorUserId: 'user-1',
    boardId: 'board-1',
    channelId: 'channel-1',
    closedAt: null,
    content: 'Add more neon.',
    createdAt: '2026-07-03T08:10:00.000Z',
    guildId: 'guild-1',
    id: 'suggestion-1',
    messageId: 'message-1',
    status: 'open',
    updatedAt: '2026-07-03T09:10:00.000Z',
};
const suggestionVote = {
    createdAt: '2026-07-03T08:15:00.000Z',
    id: 'vote-1',
    suggestionId: 'suggestion-1',
    updatedAt: '2026-07-03T09:15:00.000Z',
    userId: 'user-2',
    vote: 'up' as const,
};

describe('Convex suggestions database functions', () => {
    it('creates, upserts, lists, finds, and deletes suggestion boards through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [suggestionBoard, suggestionBoard, null],
            queryResults: [[suggestionBoard], suggestionBoard],
        });

        const created = await createSuggestionBoard(db, {
            channelId: ' channel-1 ',
            config: suggestionBoard.config,
            guildId: ' guild-1 ',
            name: ' ideas ',
        });
        const upserted = await upsertSuggestionBoard(db, {
            channelId: ' channel-1 ',
            enabled: false,
            guildId: ' guild-1 ',
            name: ' ideas ',
        });
        const listed = await listSuggestionBoardsByGuildId(db, { guildId: 'guild-1', enabledOnly: true });
        const found = await findDefaultSuggestionBoardByGuildId(db, { guildId: 'guild-1' });
        const deleted = await deleteSuggestionBoard(db, { guildId: 'guild-1', name: 'missing' });

        expect(created._unsafeUnwrap()).toStrictEqual(toBoardRecord(suggestionBoard));
        expect(upserted._unsafeUnwrap()).toStrictEqual(toBoardRecord(suggestionBoard));
        expect(listed._unsafeUnwrap()).toStrictEqual([toBoardRecord(suggestionBoard)]);
        expect(found._unsafeUnwrap()).toStrictEqual(toBoardRecord(suggestionBoard));
        expect(deleted._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            channelId: 'channel-1',
            config: suggestionBoard.config,
            guildId: 'guild-1',
            name: 'ideas',
        });
        expect(db.client.mutationCalls[1]?.args).toStrictEqual({
            channelId: 'channel-1',
            enabled: false,
            guildId: 'guild-1',
            name: 'ideas',
        });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({
            enabledOnly: true,
            guildId: 'guild-1',
        });
    });

    it('creates suggestions and applies vote reads and mutations through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [suggestion, suggestionVote, suggestionVote],
            queryResults: [suggestion, suggestionVote],
        });

        const createdSuggestion = await createSuggestion(db, {
            authorUserId: ' user-1 ',
            boardId: ' board-1 ',
            channelId: ' channel-1 ',
            content: ' Add more neon. ',
            guildId: ' guild-1 ',
            messageId: ' message-1 ',
        });
        const foundSuggestion = await findSuggestionByGuildMessageId(db, {
            guildId: ' guild-1 ',
            messageId: ' message-1 ',
        });
        const upsertedVote = await upsertSuggestionVote(db, {
            suggestionId: ' suggestion-1 ',
            userId: ' user-2 ',
            vote: ' up ',
        });
        const foundVote = await findSuggestionVote(db, {
            suggestionId: ' suggestion-1 ',
            userId: ' user-2 ',
        });
        const deletedVote = await deleteSuggestionVote(db, {
            suggestionId: ' suggestion-1 ',
            userId: ' user-2 ',
        });

        expect(createdSuggestion._unsafeUnwrap()).toStrictEqual(toSuggestionRecord(suggestion));
        expect(foundSuggestion._unsafeUnwrap()).toStrictEqual(toSuggestionRecord(suggestion));
        expect(upsertedVote._unsafeUnwrap()).toStrictEqual(toVoteRecord(suggestionVote));
        expect(foundVote._unsafeUnwrap()).toStrictEqual(toVoteRecord(suggestionVote));
        expect(deletedVote._unsafeUnwrap()).toStrictEqual(toVoteRecord(suggestionVote));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            authorUserId: 'user-1',
            boardId: 'board-1',
            channelId: 'channel-1',
            content: 'Add more neon.',
            guildId: 'guild-1',
            messageId: 'message-1',
        });
        expect(db.client.mutationCalls[1]?.args).toStrictEqual({
            suggestionId: 'suggestion-1',
            userId: 'user-2',
            vote: 'up',
        });
    });

    it('maps suggestions validation failures before calling Convex', async () => {
        const db = createConvexDb({});

        const missingBoardChannel = await upsertSuggestionBoard(db, {
            channelId: ' ',
            guildId: 'guild-1',
            name: 'ideas',
        });
        const missingSuggestionContent = await createSuggestion(db, {
            authorUserId: 'user-1',
            content: ' ',
            guildId: 'guild-1',
        });
        const invalidVote = await upsertSuggestionVote(db, {
            suggestionId: 'suggestion-1',
            userId: 'user-2',
            vote: 'maybe',
        });
        const missingVoteUser = await findSuggestionVote(db, {
            suggestionId: 'suggestion-1',
            userId: ' ',
        });

        expect(missingBoardChannel._unsafeUnwrapErr()).toStrictEqual({
            field: 'channelId',
            type: 'missing-input',
        });
        expect(missingSuggestionContent._unsafeUnwrapErr()).toStrictEqual({
            field: 'content',
            type: 'missing-input',
        });
        expect(invalidVote._unsafeUnwrapErr()).toStrictEqual({ field: 'vote', type: 'invalid-value' });
        expect(missingVoteUser._unsafeUnwrapErr()).toStrictEqual({ field: 'userId', type: 'missing-input' });
        expect(db.client.mutationCalls).toHaveLength(0);
        expect(db.client.queryCalls).toHaveLength(0);
    });

    it('maps missing suggestion reads and Convex failures to existing repository errors', async () => {
        const db = createConvexDb({
            mutationErrors: [new Error('database unavailable')],
            queryResults: [null, null],
        });

        const missingSuggestion = await findSuggestionByGuildMessageId(db, {
            guildId: 'guild-1',
            messageId: 'missing',
        });
        const missingVote = await findSuggestionVote(db, {
            suggestionId: 'suggestion-1',
            userId: 'user-2',
        });
        const failedDelete = await deleteSuggestionBoard(db, {
            guildId: 'guild-1',
            name: 'ideas',
        });

        expect(missingSuggestion._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(missingVote._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(failedDelete._unsafeUnwrapErr()).toStrictEqual({ type: 'database-error' });
    });
});

function toBoardRecord(record: typeof suggestionBoard) {
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

function toSuggestionRecord(record: typeof suggestion) {
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

function toVoteRecord(record: typeof suggestionVote) {
    return {
        createdAt: new Date(record.createdAt),
        id: record.id,
        suggestionId: record.suggestionId,
        updatedAt: new Date(record.updatedAt),
        userId: record.userId,
        vote: record.vote,
    };
}

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryErrors = [...(input.queryErrors ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        async mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) throw error;

            return mutationResults.shift();
        },
        async query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) throw error;

            return queryResults.shift();
        },
    };

    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}
