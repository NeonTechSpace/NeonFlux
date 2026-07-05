import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    incrementGuildMessageActivityDay,
    listGuildInviteSnapshots,
    loadGuildOverviewAggregate,
    recordGuildMemberFlowEvent,
    syncGuildInviteSnapshots,
} from './runtime-growth-overview.js';

const memberEvent = {
    attributionStatus: 'attributed' as const,
    eventType: 'join' as const,
    guildId: 'guild-1',
    id: 'member-event-1',
    inviteCode: 'alpha',
    inviterUserId: 'inviter-1',
    occurredAt: '2026-07-03T08:00:00.000Z',
    userId: 'user-1',
};
const inviteSnapshot = {
    active: true,
    channelId: 'channel-1',
    code: 'alpha',
    expiresAt: null,
    firstSeenAt: '2026-07-03T08:00:00.000Z',
    guildId: 'guild-1',
    id: 'invite-1',
    inviterUserId: 'inviter-1',
    lastSeenAt: '2026-07-03T09:00:00.000Z',
    maxUses: null,
    revokedAt: null,
    temporary: false,
    uses: 4,
};
const messageActivity = {
    activityDate: '2026-07-03',
    channelId: 'channel-1',
    guildId: 'guild-1',
    id: 'message-day-1',
    messageCount: 7,
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const overview = {
    trackingStartedAt: '2026-07-01T00:00:00.000Z',
    memberFlow: {
        totalJoins: 1,
        totalLeaves: 0,
        netGrowth: 1,
        graph: [{ date: '2026-07-03', joins: 1, leaves: 0, netGrowth: 1 }],
    },
    invites: {
        activeInviteCount: 1,
        totalInviteUses: 4,
        attribution: {
            ambiguous: 0,
            attributed: 1,
            'baseline-missing': 0,
            'not-applicable': 0,
            unavailable: 0,
        },
        topInviters: [
            {
                attributedJoins: 1,
                inviteCodes: [{ active: true, code: 'alpha', uses: 4 }],
                inviterUserId: 'inviter-1',
            },
        ],
    },
    messages: {
        totalMessages: 7,
        graph: [{ date: '2026-07-03', messageCount: 7 }],
        topChannels: [{ channelId: 'channel-1', messageCount: 7 }],
    },
    dataHealth: {
        hasInviteSnapshots: true,
        hasMemberFlow: true,
        hasMessageActivity: true,
    },
};

describe('Convex growth overview database functions', () => {
    it('records member flow events through Convex', async () => {
        const db = createConvexDb({ mutationResults: [memberEvent] });

        const result = await recordGuildMemberFlowEvent(db, {
            attributionStatus: 'attributed',
            eventType: 'join',
            guildId: ' guild-1 ',
            inviteCode: ' alpha ',
            inviterUserId: ' inviter-1 ',
            occurredAt: new Date('2026-07-03T08:00:00.000Z'),
            userId: ' user-1 ',
        });

        expect(result._unsafeUnwrap()).toStrictEqual(toMemberEventRecord(memberEvent));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            attributionStatus: 'attributed',
            eventType: 'join',
            guildId: 'guild-1',
            inviteCode: 'alpha',
            inviterUserId: 'inviter-1',
            occurredAt: '2026-07-03T08:00:00.000Z',
            userId: 'user-1',
        });
    });

    it('syncs and lists invite snapshots through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [[inviteSnapshot]],
            queryResults: [[inviteSnapshot]],
        });

        const synced = await syncGuildInviteSnapshots(db, {
            guildId: ' guild-1 ',
            observedAt: new Date('2026-07-03T09:00:00.000Z'),
            invites: [
                {
                    channelId: ' channel-1 ',
                    code: ' alpha ',
                    inviterUserId: ' inviter-1 ',
                    uses: 4,
                    temporary: false,
                },
            ],
        });
        const listed = await listGuildInviteSnapshots(db, { guildId: 'guild-1' });

        expect(synced._unsafeUnwrap()).toStrictEqual([toInviteSnapshotRecord(inviteSnapshot)]);
        expect(listed._unsafeUnwrap()).toStrictEqual([toInviteSnapshotRecord(inviteSnapshot)]);
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            guildId: 'guild-1',
            observedAt: '2026-07-03T09:00:00.000Z',
            invites: [
                {
                    channelId: 'channel-1',
                    code: 'alpha',
                    inviterUserId: 'inviter-1',
                    temporary: false,
                    uses: 4,
                },
            ],
        });
    });

    it('increments message activity and loads aggregates through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [messageActivity],
            queryResults: [overview],
        });

        const activity = await incrementGuildMessageActivityDay(db, {
            channelId: ' channel-1 ',
            guildId: ' guild-1 ',
            occurredAt: new Date('2026-07-03T09:00:00.000Z'),
        });
        const aggregate = await loadGuildOverviewAggregate(db, {
            days: 1,
            guildId: ' guild-1 ',
            now: new Date('2026-07-03T12:00:00.000Z'),
        });

        expect(activity._unsafeUnwrap()).toStrictEqual(toMessageActivityRecord(messageActivity));
        expect(aggregate._unsafeUnwrap()).toStrictEqual({
            ...overview,
            trackingStartedAt: new Date('2026-07-01T00:00:00.000Z'),
        });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({
            days: 1,
            guildId: 'guild-1',
            now: '2026-07-03T12:00:00.000Z',
        });
    });

    it('maps validation failures before calling Convex', async () => {
        const db = createConvexDb({});

        const missingGuild = await listGuildInviteSnapshots(db, { guildId: ' ' });
        const invalidEvent = await recordGuildMemberFlowEvent(db, {
            eventType: 'bad' as 'join',
            guildId: 'guild-1',
            userId: 'user-1',
        });
        const invalidInvite = await syncGuildInviteSnapshots(db, {
            guildId: 'guild-1',
            invites: [{ code: 'alpha', uses: -1 }],
        });
        const invalidDays = await loadGuildOverviewAggregate(db, {
            days: 91,
            guildId: 'guild-1',
        });

        expect(missingGuild._unsafeUnwrapErr()).toStrictEqual({
            field: 'guildId',
            type: 'missing-input',
        });
        expect(invalidEvent._unsafeUnwrapErr()).toStrictEqual({
            field: 'eventType',
            type: 'invalid-value',
        });
        expect(invalidInvite._unsafeUnwrapErr()).toStrictEqual({
            field: 'uses',
            type: 'invalid-value',
        });
        expect(invalidDays._unsafeUnwrapErr()).toStrictEqual({
            field: 'days',
            type: 'invalid-value',
        });
        expect(db.client.mutationCalls).toHaveLength(0);
        expect(db.client.queryCalls).toHaveLength(0);
    });

    it('maps Convex failures to database errors', async () => {
        const db = createConvexDb({ mutationErrors: [new Error('guild-not-found')] });

        const result = await incrementGuildMessageActivityDay(db, {
            channelId: 'channel-1',
            guildId: 'guild-1',
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'database-error' });
    });
});

function toMemberEventRecord(record: typeof memberEvent) {
    return {
        attributionStatus: record.attributionStatus,
        eventType: record.eventType,
        guildId: record.guildId,
        id: record.id,
        inviteCode: record.inviteCode,
        inviterUserId: record.inviterUserId,
        occurredAt: new Date(record.occurredAt),
        userId: record.userId,
    };
}

function toInviteSnapshotRecord(record: typeof inviteSnapshot) {
    return {
        active: record.active,
        channelId: record.channelId,
        code: record.code,
        expiresAt: record.expiresAt,
        firstSeenAt: new Date(record.firstSeenAt),
        guildId: record.guildId,
        id: record.id,
        inviterUserId: record.inviterUserId,
        lastSeenAt: new Date(record.lastSeenAt),
        maxUses: record.maxUses,
        revokedAt: record.revokedAt,
        temporary: record.temporary,
        uses: record.uses,
    };
}

function toMessageActivityRecord(record: typeof messageActivity) {
    return {
        activityDate: record.activityDate,
        channelId: record.channelId,
        guildId: record.guildId,
        id: record.id,
        messageCount: record.messageCount,
        updatedAt: new Date(record.updatedAt),
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
        mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) return Promise.reject(error);

            return Promise.resolve(mutationResults.shift());
        },
        query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) return Promise.reject(error);

            return Promise.resolve(queryResults.shift());
        },
    };

    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}
