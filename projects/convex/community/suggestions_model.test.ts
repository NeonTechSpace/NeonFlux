import { describe, expect, it } from 'vitest';
import type { GenericId } from 'convex/values';

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
} from './suggestions_model.js';

const now = '2026-07-03T08:00:00.000Z';
const boardId = 'board-doc-1' as GenericId<'suggestionBoards'>;
const suggestionId = 'suggestion-doc-1' as GenericId<'suggestions'>;
const voteId = 'vote-doc-1';

describe('suggestions model', () => {
    it('normalizes suggestion board input and defaults enabled/config', () => {
        const document = buildSuggestionBoardDocument(
            {
                channelId: ' channel-1 ',
                guildId: ' guild-1 ',
                name: ' Ideas ',
            },
            now
        );

        expect(document).toEqual({
            ok: true,
            value: {
                channelId: 'channel-1',
                config: {},
                createdAt: now,
                enabled: true,
                guildId: 'guild-1',
                name: 'Ideas',
                updatedAt: now,
            },
        });

        if (!document.ok) throw new Error('Expected normalized board.');

        expect(toSuggestionBoardRecord({ ...document.value, _id: boardId })).toEqual({
            channelId: 'channel-1',
            config: {},
            createdAt: now,
            enabled: true,
            guildId: 'guild-1',
            id: boardId,
            name: 'Ideas',
            updatedAt: now,
        });
    });

    it('preserves board creation metadata on upsert', () => {
        expect(
            buildSuggestionBoardDocument(
                {
                    channelId: 'channel-2',
                    config: { marker: 'idea' },
                    enabled: false,
                    guildId: 'guild-1',
                    name: 'Ideas',
                },
                now,
                {
                    createdAt: '2026-07-02T08:00:00.000Z',
                }
            )
        ).toEqual({
            ok: true,
            value: {
                channelId: 'channel-2',
                config: { marker: 'idea' },
                createdAt: '2026-07-02T08:00:00.000Z',
                enabled: false,
                guildId: 'guild-1',
                name: 'Ideas',
                updatedAt: now,
            },
        });
    });

    it('normalizes suggestion input and optional Fluxer runtime fields', () => {
        const document = buildSuggestionDocument(
            {
                authorUserId: ' user-1 ',
                boardId,
                channelId: ' channel-1 ',
                content: ' Build the thing ',
                guildId: ' guild-1 ',
                messageId: ' message-1 ',
            },
            now
        );

        expect(document).toEqual({
            ok: true,
            value: {
                authorUserId: 'user-1',
                boardId,
                channelId: 'channel-1',
                content: 'Build the thing',
                createdAt: now,
                guildId: 'guild-1',
                messageId: 'message-1',
                status: 'open',
                updatedAt: now,
            },
        });

        if (!document.ok) throw new Error('Expected normalized suggestion.');

        expect(toSuggestionRecord({ ...document.value, _id: suggestionId })).toEqual({
            authorUserId: 'user-1',
            boardId,
            channelId: 'channel-1',
            closedAt: null,
            content: 'Build the thing',
            createdAt: now,
            guildId: 'guild-1',
            id: suggestionId,
            messageId: 'message-1',
            status: 'open',
            updatedAt: now,
        });
    });

    it('normalizes suggestion vote upserts and validates vote values', () => {
        const document = buildSuggestionVoteDocument(
            {
                suggestionId,
                userId: ' user-1 ',
                vote: ' up ',
            },
            now
        );

        expect(document).toEqual({
            ok: true,
            value: {
                createdAt: now,
                suggestionId,
                updatedAt: now,
                userId: 'user-1',
                vote: 'up',
            },
        });

        if (!document.ok) throw new Error('Expected normalized vote.');

        expect(toSuggestionVoteRecord({ ...document.value, _id: voteId })).toEqual({
            createdAt: now,
            id: voteId,
            suggestionId,
            updatedAt: now,
            userId: 'user-1',
            vote: 'up',
        });
        expect(buildSuggestionVoteDocument({ suggestionId: 's', userId: 'u', vote: 'sideways' }, now)).toEqual({
            error: { field: 'vote', type: 'invalid-value' },
            ok: false,
        });
    });

    it('preserves imported timestamps and rejects invalid inputs', () => {
        expect(
            buildSuggestionDocument(
                {
                    authorUserId: 'user-1',
                    closedAt: '2026-07-04 09:00:00+02',
                    content: 'Done',
                    createdAt: '2026-07-02 09:00:00+02',
                    guildId: 'guild-1',
                    status: 'accepted',
                    updatedAt: '2026-07-03 09:00:00+02',
                },
                now
            )
        ).toMatchObject({
            ok: true,
            value: {
                closedAt: '2026-07-04T07:00:00.000Z',
                createdAt: '2026-07-02T07:00:00.000Z',
                updatedAt: '2026-07-03T07:00:00.000Z',
            },
        });
        expect(buildSuggestionBoardDocument({ channelId: '', guildId: 'g', name: 'Ideas' }, now)).toEqual({
            error: { field: 'channelId', type: 'missing-input' },
            ok: false,
        });
        expect(
            buildSuggestionBoardDocument({ channelId: 'c', config: [] as never, guildId: 'g', name: 'n' }, now)
        ).toEqual({
            error: { field: 'config', type: 'invalid-value' },
            ok: false,
        });
    });

    it('normalizes lookup helpers and bounded limits', () => {
        expect(normalizeRequiredGuildId(' guild-1 ')).toEqual({ ok: true, value: 'guild-1' });
        expect(normalizeRequiredBoardName(' ideas ')).toEqual({ ok: true, value: 'ideas' });
        expect(normalizeRequiredMessageId(' message-1 ')).toEqual({ ok: true, value: 'message-1' });
        expect(normalizeRequiredSuggestionId(' suggestion-1 ')).toEqual({ ok: true, value: 'suggestion-1' });
        expect(normalizeRequiredUserId(' user-1 ')).toEqual({ ok: true, value: 'user-1' });
        expect(normalizeSuggestionLimit(undefined)).toBe(100);
        expect(normalizeSuggestionLimit(0)).toBe(1);
        expect(normalizeSuggestionLimit(800)).toBe(500);
    });
});
