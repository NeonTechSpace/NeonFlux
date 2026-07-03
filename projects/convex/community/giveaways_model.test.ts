import { describe, expect, it } from 'vitest';

import {
    buildGiveawayDocument,
    buildGiveawayEntryDocument,
    buildGiveawayEventDocument,
    buildGiveawayStatusPatch,
    buildGiveawayWinnerDocument,
    normalizeGiveawayLimit,
    normalizeRequiredGiveawayId,
    normalizeRequiredGuildId,
    normalizeRequiredMessageId,
    toGiveawayEntryRecord,
    toGiveawayEventRecord,
    toGiveawayRecord,
    toGiveawayWinnerRecord,
} from './giveaways_model.js';

const now = '2026-07-03T08:00:00.000Z';

describe('giveaways model', () => {
    it('normalizes giveaway input with defaults and app-facing records', () => {
        const document = buildGiveawayDocument(
            {
                channelId: ' channel-1 ',
                description: ' Launch week ',
                guildId: ' guild-1 ',
                messageId: ' message-1 ',
                prize: ' Nitro ',
                title: ' Launch giveaway ',
            },
            now,
            () => 'giveaway-1'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                channelId: 'channel-1',
                config: {},
                createdAt: now,
                description: 'Launch week',
                entryEmoji: '\u{1f389}',
                guildId: 'guild-1',
                legacyId: 'giveaway-1',
                messageId: 'message-1',
                prize: 'Nitro',
                status: 'draft',
                title: 'Launch giveaway',
                updatedAt: now,
                winnerCount: 1,
            },
        });

        if (!document.ok) throw new Error('Expected normalized giveaway.');

        expect(toGiveawayRecord(document.value)).toMatchObject({
            closedAt: null,
            closedByUserId: null,
            createdByUserId: null,
            description: 'Launch week',
            endsAt: null,
            id: 'giveaway-1',
            messageId: 'message-1',
        });
    });

    it('preserves imported timestamps and validates winner count', () => {
        expect(
            buildGiveawayDocument(
                {
                    channelId: 'channel-1',
                    createdAt: '2026-07-02 09:00:00+02',
                    endsAt: '2026-07-04 09:00:00+02',
                    guildId: 'guild-1',
                    legacyId: 'legacy-giveaway',
                    prize: 'Nitro',
                    status: 'active',
                    title: 'Launch',
                    updatedAt: '2026-07-03 09:00:00+02',
                    winnerCount: 25,
                },
                now
            )
        ).toMatchObject({
            ok: true,
            value: {
                createdAt: '2026-07-02T07:00:00.000Z',
                endsAt: '2026-07-04T07:00:00.000Z',
                legacyId: 'legacy-giveaway',
                updatedAt: '2026-07-03T07:00:00.000Z',
            },
        });
        expect(
            buildGiveawayDocument({ channelId: 'c', guildId: 'g', prize: 'p', title: 't', winnerCount: 26 }, now)
        ).toEqual({
            error: { field: 'winnerCount', type: 'invalid-value' },
            ok: false,
        });
    });

    it('validates giveaway status transitions', () => {
        expect(
            buildGiveawayStatusPatch({ status: 'active' }, { actorUserId: ' actor-1 ', status: 'closed' }, now)
        ).toEqual({
            ok: true,
            value: {
                closedAt: now,
                closedByUserId: 'actor-1',
                status: 'closed',
                updatedAt: now,
            },
        });
        expect(buildGiveawayStatusPatch({ status: 'cancelled' }, { status: 'closed' }, now)).toEqual({
            error: { from: 'cancelled', to: 'closed', type: 'invalid-status-transition' },
            ok: false,
        });
    });

    it('normalizes entries, winners, and events', () => {
        const entry = buildGiveawayEntryDocument(
            { giveawayId: ' giveaway-1 ', userId: ' user-1 ' },
            now,
            undefined,
            () => 'entry-1'
        );
        const winner = buildGiveawayWinnerDocument(
            { drawNumber: 2, giveawayId: ' giveaway-1 ', userId: ' user-1 ' },
            now,
            () => 'winner-1'
        );
        const event = buildGiveawayEventDocument(
            {
                actorUserId: ' actor-1 ',
                details: { winnerCount: 1 },
                eventType: ' closed ',
                giveawayId: ' giveaway-1 ',
            },
            now,
            () => 'event-1'
        );

        expect(entry).toMatchObject({
            ok: true,
            value: { giveawayLegacyId: 'giveaway-1', legacyId: 'entry-1', userId: 'user-1' },
        });
        expect(winner).toMatchObject({
            ok: true,
            value: { drawNumber: 2, giveawayLegacyId: 'giveaway-1', legacyId: 'winner-1', userId: 'user-1' },
        });
        expect(event).toMatchObject({
            ok: true,
            value: { actorUserId: 'actor-1', eventType: 'closed', legacyId: 'event-1' },
        });

        if (!entry.ok || !winner.ok || !event.ok) throw new Error('Expected normalized giveaway records.');

        expect(toGiveawayEntryRecord(entry.value)).toEqual({
            enteredAt: now,
            giveawayId: 'giveaway-1',
            id: 'entry-1',
            removedAt: null,
            userId: 'user-1',
        });
        expect(toGiveawayWinnerRecord(winner.value)).toEqual({
            drawNumber: 2,
            giveawayId: 'giveaway-1',
            id: 'winner-1',
            selectedAt: now,
            userId: 'user-1',
        });
        expect(toGiveawayEventRecord(event.value)).toEqual({
            actorUserId: 'actor-1',
            createdAt: now,
            details: { winnerCount: 1 },
            eventType: 'closed',
            giveawayId: 'giveaway-1',
            id: 'event-1',
        });
    });

    it('normalizes helpers and bounded limits', () => {
        expect(normalizeRequiredGuildId(' guild-1 ')).toEqual({ ok: true, value: 'guild-1' });
        expect(normalizeRequiredGiveawayId(' giveaway-1 ')).toEqual({ ok: true, value: 'giveaway-1' });
        expect(normalizeRequiredMessageId(' message-1 ')).toEqual({ ok: true, value: 'message-1' });
        expect(normalizeGiveawayLimit(undefined)).toBe(50);
        expect(normalizeGiveawayLimit(0)).toBe(1);
        expect(normalizeGiveawayLimit(500)).toBe(100);
    });
});
