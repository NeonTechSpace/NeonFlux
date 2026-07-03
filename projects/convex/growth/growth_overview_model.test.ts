import { describe, expect, it } from 'vitest';

import {
    buildGuildInviteSnapshotDocument,
    buildGuildMemberFlowEventDocument,
    buildGuildMessageActivityDayDocument,
    normalizeObservedAt,
    normalizeOverviewDays,
    revokeGuildInviteSnapshotDocument,
    toGuildInviteSnapshotRecord,
    toGuildMemberFlowEventRecord,
    toGuildMessageActivityDayRecord,
    toGuildOverviewAggregate,
} from './growth_overview_model.js';

const now = '2026-07-03T08:00:00.000Z';

describe('growth overview model', () => {
    it('normalizes member flow events and defaults attribution status', () => {
        const join = buildGuildMemberFlowEventDocument(
            { eventType: 'join', guildId: ' guild-1 ', userId: ' user-1 ' },
            now,
            () => 'event-1'
        );
        const leave = buildGuildMemberFlowEventDocument(
            { eventType: 'leave', guildId: 'guild-1', userId: 'user-1' },
            now,
            () => 'event-2'
        );

        expect(join).toMatchObject({
            ok: true,
            value: { attributionStatus: 'unavailable', eventType: 'join', legacyId: 'event-1' },
        });
        expect(leave).toMatchObject({
            ok: true,
            value: { attributionStatus: 'not-applicable', eventType: 'leave', legacyId: 'event-2' },
        });

        if (!join.ok) throw new Error('Expected join event.');

        expect(toGuildMemberFlowEventRecord(join.value)).toMatchObject({
            id: 'event-1',
            inviteCode: null,
            inviterUserId: null,
        });
    });

    it('normalizes invite snapshots and revokes missing active snapshots', () => {
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
            { firstSeenAt: '2026-07-01T00:00:00.000Z', legacyId: 'invite-1' }
        );

        expect(snapshot).toMatchObject({
            ok: true,
            value: {
                active: true,
                channelId: 'channel-1',
                code: 'invite-a',
                firstSeenAt: '2026-07-01T00:00:00.000Z',
                legacyId: 'invite-1',
                maxUses: 10,
                temporary: true,
                uses: 4,
            },
        });

        if (!snapshot.ok) throw new Error('Expected invite snapshot.');

        const revoked = revokeGuildInviteSnapshotDocument(snapshot.value, '2026-07-04T00:00:00.000Z');

        expect(toGuildInviteSnapshotRecord(revoked)).toMatchObject({
            active: false,
            id: 'invite-1',
            revokedAt: '2026-07-04T00:00:00.000Z',
        });
    });

    it('increments message activity days by UTC date', () => {
        const initial = buildGuildMessageActivityDayDocument(
            { channelId: 'channel-1', guildId: 'guild-1', occurredAt: '2026-07-03T23:59:00.000Z' },
            now
        );

        if (!initial.ok) throw new Error('Expected message activity day.');

        const next = buildGuildMessageActivityDayDocument(
            { channelId: 'channel-1', guildId: 'guild-1', occurredAt: '2026-07-03T23:59:10.000Z' },
            now,
            initial.value
        );

        expect(next).toMatchObject({
            ok: true,
            value: { activityDate: '2026-07-03', messageCount: 2 },
        });
        expect(toGuildMessageActivityDayRecord(initial.value)).toMatchObject({ id: initial.value.legacyId });
    });

    it('builds aggregate graphs, attribution counts, and top lists', () => {
        const join = buildGuildMemberFlowEventDocument(
            {
                attributionStatus: 'attributed',
                eventType: 'join',
                guildId: 'guild-1',
                inviterUserId: 'inviter-1',
                occurredAt: '2026-07-02T12:00:00.000Z',
                userId: 'user-1',
            },
            now,
            () => 'event-1'
        );
        const leave = buildGuildMemberFlowEventDocument(
            {
                eventType: 'leave',
                guildId: 'guild-1',
                occurredAt: '2026-07-03T12:00:00.000Z',
                userId: 'user-2',
            },
            now,
            () => 'event-2'
        );
        const invite = buildGuildInviteSnapshotDocument(
            'guild-1',
            { code: 'invite-a', inviterUserId: 'inviter-1', uses: 7 },
            '2026-07-01T00:00:00.000Z'
        );
        const messageDay = buildGuildMessageActivityDayDocument(
            { channelId: 'channel-1', guildId: 'guild-1', occurredAt: '2026-07-03T08:00:00.000Z' },
            now
        );

        if (!join.ok || !leave.ok || !invite.ok || !messageDay.ok) throw new Error('Expected valid fixtures.');

        expect(
            toGuildOverviewAggregate({
                days: 2,
                inviteSnapshots: [invite.value],
                memberEvents: [join.value, leave.value],
                messageActivityDays: [messageDay.value],
                now,
            })
        ).toMatchObject({
            invites: {
                activeInviteCount: 1,
                attribution: { attributed: 1, 'not-applicable': 1 },
                topInviters: [{ attributedJoins: 1, inviterUserId: 'inviter-1' }],
                totalInviteUses: 7,
            },
            memberFlow: {
                graph: [
                    { date: '2026-07-02', joins: 1, leaves: 0, netGrowth: 1 },
                    { date: '2026-07-03', joins: 0, leaves: 1, netGrowth: -1 },
                ],
                netGrowth: 0,
                totalJoins: 1,
                totalLeaves: 1,
            },
            messages: {
                graph: [
                    { date: '2026-07-02', messageCount: 0 },
                    { date: '2026-07-03', messageCount: 1 },
                ],
                topChannels: [{ channelId: 'channel-1', messageCount: 1 }],
                totalMessages: 1,
            },
            trackingStartedAt: '2026-07-01T00:00:00.000Z',
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
