import { describe, expect, it } from 'vitest';

import {
    botActionEventMatchesSearch,
    buildBotActionEventDocument,
    normalizeBotActionEventCursor,
    normalizeBotActionEventLimit,
    normalizeBotActionEventSearch,
    normalizeRequiredGuildId,
    toBotActionEventRecord,
} from './events_model.js';

describe('bot action event model', () => {
    it('normalizes event input into a Convex document and app-facing record', () => {
        const document = buildBotActionEventDocument(
            {
                action: ' message.sent ',
                actorUserId: ' user-1 ',
                feature: ' posting ',
                guildId: ' guild-1 ',
                metadata: { channelId: 'channel-1' },
                targetId: ' message-1 ',
            },
            '2026-07-03T07:00:00.000Z',
            () => 'event-1'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                action: 'message.sent',
                actorUserId: 'user-1',
                createdAt: '2026-07-03T07:00:00.000Z',
                feature: 'posting',
                guildId: 'guild-1',
                legacyId: 'event-1',
                metadata: { channelId: 'channel-1' },
                targetId: 'message-1',
            },
        });

        if (!document.ok) {
            throw new Error('Expected normalized event document.');
        }

        expect(toBotActionEventRecord(document.value)).toEqual({
            action: 'message.sent',
            actorUserId: 'user-1',
            createdAt: '2026-07-03T07:00:00.000Z',
            feature: 'posting',
            guildId: 'guild-1',
            id: 'event-1',
            metadata: { channelId: 'channel-1' },
            targetId: 'message-1',
        });
    });

    it('preserves legacy ids and explicit timestamps for migration imports', () => {
        expect(
            buildBotActionEventDocument(
                {
                    action: 'prefix.updated',
                    createdAt: '2026-07-03 09:30:00+02',
                    feature: 'settings',
                    legacyId: 'legacy-1',
                },
                '2026-07-03T07:00:00.000Z',
                () => 'new-id'
            )
        ).toMatchObject({
            ok: true,
            value: {
                createdAt: '2026-07-03T07:30:00.000Z',
                legacyId: 'legacy-1',
            },
        });
    });

    it('rejects missing required fields and invalid metadata', () => {
        expect(buildBotActionEventDocument({ action: 'created' }, '2026-07-03T07:00:00.000Z')).toEqual({
            error: 'missing-feature',
            ok: false,
        });
        expect(buildBotActionEventDocument({ feature: 'posting' }, '2026-07-03T07:00:00.000Z')).toEqual({
            error: 'missing-action',
            ok: false,
        });
        expect(
            buildBotActionEventDocument(
                { action: 'created', feature: 'posting', metadata: ['not', 'record'] },
                '2026-07-03T07:00:00.000Z'
            )
        ).toEqual({
            error: 'invalid-metadata',
            ok: false,
        });
    });

    it('normalizes guild id, cursor, limits, and search input', () => {
        expect(normalizeRequiredGuildId(' guild-1 ')).toEqual({ ok: true, value: 'guild-1' });
        expect(normalizeRequiredGuildId(' ')).toEqual({ error: 'missing-guild-id', ok: false });
        expect(
            normalizeBotActionEventCursor({
                createdAt: '2026-07-03 09:30:00+02',
                id: ' event-1 ',
            })
        ).toEqual({
            ok: true,
            value: {
                createdAt: '2026-07-03T07:30:00.000Z',
                id: 'event-1',
            },
        });
        expect(normalizeBotActionEventCursor({ createdAt: 'nope', id: 'event-1' })).toEqual({
            error: 'invalid-cursor',
            ok: false,
        });
        expect(normalizeBotActionEventLimit(undefined)).toBe(25);
        expect(normalizeBotActionEventLimit(0)).toBe(1);
        expect(normalizeBotActionEventLimit(250)).toBe(100);
        expect(normalizeBotActionEventSearch({ search: '', searchScope: 'invalid' })).toEqual({
            scope: 'all',
            tokens: [],
        });
        expect(
            normalizeBotActionEventSearch({
                search: ' channel-1 actor-1 !!! ignored ignored2 ignored3 ignored4 ignored5 ignored6 ignored7 ignored8 ',
                searchOffsetMinutes: 2000,
                searchScope: 'channel',
            })
        ).toEqual({
            offsetMinutes: 1440,
            scope: 'channel',
            tokens: ['channel1', 'actor1', 'ignored', 'ignored2', 'ignored3', 'ignored4', 'ignored5', 'ignored6'],
        });
    });

    it('matches scoped normalized audit search text', () => {
        const document = buildBotActionEventDocument(
            {
                action: 'message.sent',
                actorUserId: 'actor-0',
                createdAt: '2026-07-03T10:30:00.000Z',
                feature: 'posting',
                guildId: 'guild-1',
                metadata: {
                    actorUsername: 'neon-0',
                    channelId: 'channel-0',
                    channelName: 'support-hub',
                    messageId: 'message-0',
                    source: 'dashboard',
                },
                targetId: 'message-0',
            },
            '2026-07-03T10:30:00.000Z',
            () => 'event-1'
        );

        expect(document.ok).toBe(true);
        if (!document.ok) return;

        expect(
            botActionEventMatchesSearch(document.value, normalizeBotActionEventSearch({ search: 'channel-0 actor-0' }))
        ).toBe(true);
        expect(
            botActionEventMatchesSearch(
                document.value,
                normalizeBotActionEventSearch({ search: 'neon-0', searchScope: 'actor' })
            )
        ).toBe(true);
        expect(
            botActionEventMatchesSearch(
                document.value,
                normalizeBotActionEventSearch({ search: 'channel-0', searchScope: 'channel' })
            )
        ).toBe(true);
        expect(
            botActionEventMatchesSearch(
                document.value,
                normalizeBotActionEventSearch({ search: 'chnl0', searchScope: 'channel' })
            )
        ).toBe(false);
        expect(
            botActionEventMatchesSearch(
                document.value,
                normalizeBotActionEventSearch({
                    search: '2026-07-03 12:30',
                    searchOffsetMinutes: -120,
                    searchScope: 'time',
                })
            )
        ).toBe(true);
    });
});
