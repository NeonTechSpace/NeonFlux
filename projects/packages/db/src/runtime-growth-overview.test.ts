import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    loadGuildOverviewAggregate,
    recordGuildMemberFlowEvent,
    recordGuildMessageActivity,
} from './runtime-growth-overview.js';

const memberEvent = {
    eventType: 'join' as const,
    guildId: 'guild-1',
    id: 'member-event-1',
    membershipStartedAt: '2026-07-03T08:00:00.000Z',
    occurredAt: '2026-07-03T08:00:00.000Z',
    userId: 'user-1',
};
const messageActivity = {
    activityDate: '2026-07-03',
    guildId: 'guild-1',
    shard: 12,
    status: 'recorded' as const,
};
const overview = {
    oldestRetainedActivityAt: '2026-07-01T00:00:00.000Z',
    windowDays: 1,
    activityPresence: {
        hasMemberFlow: true,
        hasMessageActivity: true,
    },
    memberFlow: {
        totalJoins: 1,
        totalLeaves: 0,
        netGrowth: 1,
        graph: [{ date: '2026-07-03', joins: 1, leaves: 0, netGrowth: 1 }],
    },
    messages: {
        totalMessages: 7,
        graph: [{ date: '2026-07-03', messageCount: 7 }],
    },
};

describe('Convex growth overview database functions', () => {
    it('records normalized member flow events through Convex', async () => {
        const db = createConvexDb({ mutationResults: [memberEvent] });

        const result = await recordGuildMemberFlowEvent(db, {
            eventType: 'join',
            guildId: ' guild-1 ',
            membershipStartedAt: new Date('2026-07-03T08:00:00.000Z'),
            occurredAt: new Date('2026-07-03T08:00:00.000Z'),
            userId: ' user-1 ',
        });

        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'join',
            guildId: 'guild-1',
            id: 'member-event-1',
            membershipStartedAt: new Date('2026-07-03T08:00:00.000Z'),
            occurredAt: new Date('2026-07-03T08:00:00.000Z'),
            userId: 'user-1',
        });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            eventType: 'join',
            guildId: 'guild-1',
            membershipStartedAt: '2026-07-03T08:00:00.000Z',
            occurredAt: '2026-07-03T08:00:00.000Z',
            userId: 'user-1',
        });
    });

    it('records message activity and loads only observable aggregate data', async () => {
        const db = createConvexDb({
            mutationResults: [messageActivity],
            queryResults: [overview],
        });

        const activity = await recordGuildMessageActivity(db, {
            guildId: ' guild-1 ',
            messageId: ' message-1 ',
            occurredAt: new Date('2026-07-03T09:00:00.000Z'),
        });
        const aggregate = await loadGuildOverviewAggregate(db, {
            days: 1,
            guildId: ' guild-1 ',
            now: new Date('2026-07-03T12:00:00.000Z'),
        });

        expect(activity._unsafeUnwrap()).toStrictEqual(messageActivity);
        expect(aggregate._unsafeUnwrap()).toStrictEqual({
            ...overview,
            oldestRetainedActivityAt: new Date('2026-07-01T00:00:00.000Z'),
        });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({
            days: 1,
            guildId: 'guild-1',
            now: '2026-07-03T12:00:00.000Z',
        });
    });

    it('forwards cancellation signals through telemetry mutations', async () => {
        const signal = new AbortController().signal;
        const db = createConvexDb({ mutationResults: [memberEvent, messageActivity] });

        await recordGuildMemberFlowEvent(
            db,
            {
                eventType: 'join',
                guildId: 'guild-1',
                membershipStartedAt: new Date('2026-07-03T08:00:00.000Z'),
                userId: 'user-1',
            },
            { signal }
        );
        await recordGuildMessageActivity(db, { guildId: 'guild-1', messageId: 'message-1' }, { signal });

        expect(db.client.mutationCalls.map(({ options }) => options)).toStrictEqual([{ signal }, { signal }]);
    });

    it('rejects invalid member identities and overview windows before calling Convex', async () => {
        const db = createConvexDb({});
        const missingJoinIdentity = await recordGuildMemberFlowEvent(db, {
            eventType: 'join',
            guildId: 'guild-1',
            userId: 'user-1',
        });
        const invalidEvent = await recordGuildMemberFlowEvent(db, {
            eventType: 'bad' as 'join',
            guildId: 'guild-1',
            userId: 'user-1',
        });
        const invalidDays = await loadGuildOverviewAggregate(db, {
            days: 91,
            guildId: 'guild-1',
        });

        expect(missingJoinIdentity._unsafeUnwrapErr()).toStrictEqual({
            field: 'membershipStartedAt',
            type: 'missing-input',
        });
        expect(invalidEvent._unsafeUnwrapErr()).toStrictEqual({
            field: 'eventType',
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

        const result = await recordGuildMessageActivity(db, {
            guildId: 'guild-1',
            messageId: 'message-1',
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'database-error' });
    });
});

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; options: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; options: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryErrors = [...(input.queryErrors ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; options: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; options: unknown; reference: unknown }>,
        mutation(reference: unknown, args: unknown, options?: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, options, reference });
            const error = mutationErrors.shift();

            if (error) return Promise.reject(error);

            return Promise.resolve(mutationResults.shift());
        },
        query(reference: unknown, args: unknown, options?: unknown): Promise<unknown> {
            this.queryCalls.push({ args, options, reference });
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
