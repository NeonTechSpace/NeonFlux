import { describe, expect, it } from 'vitest';
import type { GenericId } from 'convex/values';

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
const giveawayId = 'giveaway-1' as GenericId<'giveaways'>;
const entryId = 'entry-1' as GenericId<'giveawayEntries'>;
const winnerId = 'winner-1' as GenericId<'giveawayWinners'>;
const eventId = 'event-1' as GenericId<'giveawayEvents'>;

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
            now
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
                messageId: 'message-1',
                prize: 'Nitro',
                status: 'draft',
                title: 'Launch giveaway',
                updatedAt: now,
                winnerCount: 1,
            },
        });

        if (!document.ok) throw new Error('Expected normalized giveaway.');

        expect(toGiveawayRecord({ ...document.value, _id: giveawayId })).toMatchObject({
            closedAt: null,
            closedByUserId: null,
            createdByUserId: null,
            description: 'Launch week',
            endsAt: null,
            id: giveawayId,
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
        const entry = buildGiveawayEntryDocument({ giveawayId: ' giveaway-1 ', userId: ' user-1 ' }, now);
        const winner = buildGiveawayWinnerDocument(
            { drawNumber: 2, giveawayId: ' giveaway-1 ', userId: ' user-1 ' },
            now
        );
        const event = buildGiveawayEventDocument(
            {
                actorUserId: ' actor-1 ',
                details: { winnerCount: 1 },
                eventType: ' closed ',
                giveawayId: ' giveaway-1 ',
            },
            now
        );

        expect(entry).toMatchObject({
            ok: true,
            value: { giveawayId, userId: 'user-1' },
        });
        expect(winner).toMatchObject({
            ok: true,
            value: { drawNumber: 2, giveawayId, userId: 'user-1' },
        });
        expect(event).toMatchObject({
            ok: true,
            value: { actorUserId: 'actor-1', eventType: 'closed', giveawayId },
        });

        if (!entry.ok || !winner.ok || !event.ok) throw new Error('Expected normalized giveaway records.');

        expect(toGiveawayEntryRecord({ ...entry.value, _id: entryId })).toEqual({
            enteredAt: now,
            giveawayId,
            id: entryId,
            removedAt: null,
            userId: 'user-1',
        });
        expect(toGiveawayWinnerRecord({ ...winner.value, _id: winnerId })).toEqual({
            drawNumber: 2,
            giveawayId,
            id: winnerId,
            selectedAt: now,
            userId: 'user-1',
        });
        expect(toGiveawayEventRecord({ ...event.value, _id: eventId })).toEqual({
            actorUserId: 'actor-1',
            createdAt: now,
            details: { winnerCount: 1 },
            eventType: 'closed',
            giveawayId,
            id: eventId,
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
