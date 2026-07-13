import { describe, expect, it } from 'vitest';

import {
    buildGuildInviteSnapshotDocument,
    buildGuildMemberFlowEventDocument,
    normalizeObservedAt,
    normalizeOverviewDays,
} from './growth_overview_model.js';

const now = '2026-07-03T08:00:00.000Z';

describe('growth overview model', () => {
    it('normalizes member flow events and defaults attribution status', () => {
        const join = buildGuildMemberFlowEventDocument(
            { eventType: 'join', guildId: ' guild-1 ', userId: ' user-1 ' },
            now
        );
        const leave = buildGuildMemberFlowEventDocument(
            { eventType: 'leave', guildId: 'guild-1', userId: 'user-1' },
            now
        );

        expect(join).toMatchObject({
            ok: true,
            value: { attributionStatus: 'unavailable', eventType: 'join' },
        });
        expect(leave).toMatchObject({
            ok: true,
            value: { attributionStatus: 'not-applicable', eventType: 'leave' },
        });
    });

    it('normalizes current invite snapshots', () => {
        const snapshot = buildGuildInviteSnapshotDocument(
            'guild-1',
            {
                channelId: ' channel-1 ',
                code: ' invite-a ',
                inviterUserId: ' inviter-1 ',
                maxUses: 10,
                temporary: true,
                uses: 4,
            },
            now,
            { firstSeenAt: '2026-07-01T00:00:00.000Z' }
        );

        expect(snapshot).toMatchObject({
            ok: true,
            value: {
                active: true,
                channelId: 'channel-1',
                code: 'invite-a',
                firstSeenAt: '2026-07-01T00:00:00.000Z',
                maxUses: 10,
                temporary: true,
                uses: 4,
            },
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
