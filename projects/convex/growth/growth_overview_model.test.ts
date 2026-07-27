import { describe, expect, it } from 'vitest';

import {
    buildGuildMemberFlowEventDocument,
    normalizeObservedAt,
    normalizeOverviewDays,
} from './growth_overview_model.js';

const now = '2026-07-03T08:00:00.000Z';

describe('growth overview model', () => {
    it('normalizes member flow events and enforces join identity', () => {
        const join = buildGuildMemberFlowEventDocument(
            {
                eventType: 'join',
                guildId: ' guild-1 ',
                membershipStartedAt: now,
                userId: ' user-1 ',
            },
            now
        );
        const leave = buildGuildMemberFlowEventDocument(
            { eventType: 'leave', guildId: 'guild-1', userId: 'user-1' },
            now
        );

        expect(join).toMatchObject({
            ok: true,
            value: { eventType: 'join', membershipStartedAt: now },
        });
        expect(leave).toMatchObject({
            ok: true,
            value: { eventType: 'leave' },
        });
        expect(
            buildGuildMemberFlowEventDocument(
                {
                    eventType: 'join',
                    guildId: 'guild-1',
                    userId: 'user-1',
                },
                now
            )
        ).toEqual({
            error: { field: 'membershipStartedAt', type: 'missing-input' },
            ok: false,
        });
    });

    it('validates overview inputs', () => {
        expect(normalizeOverviewDays(undefined)).toEqual({ ok: true, value: 30 });
        expect(normalizeOverviewDays(91)).toEqual({ error: { field: 'days', type: 'invalid-value' }, ok: false });
        expect(normalizeObservedAt(now)).toEqual({ ok: true, value: now });
        expect(normalizeObservedAt('not-a-date')).toEqual({
            error: { field: 'observedAt', type: 'invalid-value' },
            ok: false,
        });
    });
});
