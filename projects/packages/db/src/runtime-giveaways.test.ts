import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    createGiveaway,
    drawGiveawayWinners,
    findActiveGiveawayByGuildMessageId,
    listActiveGiveawayEntries,
    listGiveawaysByGuildId,
    listGiveawayWinners,
    recordGiveawayEvent,
    removeGiveawayEntry,
    updateGiveawayStatus,
    upsertGiveawayEntry,
} from './runtime-giveaways.js';
import {
    listExpiredActiveGiveaways,
    listReactionReconciliationGiveaways,
    listStaleActiveGiveaways,
    reconcileGiveawayEntries,
    updateGiveawaySyncStatus,
} from './runtime-giveaways-maintenance.js';

const giveaway = {
    channelId: 'channel-1',
    closedAt: null,
    closedByUserId: null,
    config: { syncStatus: 'stale' },
    createdAt: '2026-07-03T08:00:00.000Z',
    createdByUserId: 'creator-1',
    description: 'Daily giveaway',
    endsAt: '2026-07-03T10:00:00.000Z',
    entryEmoji: '🎉',
    guildId: 'guild-1',
    id: 'giveaway-1',
    messageId: 'message-1',
    prize: 'Nitro',
    status: 'active' as const,
    title: 'Daily Nitro',
    updatedAt: '2026-07-03T09:00:00.000Z',
    winnerCount: 2,
};
const closedGiveaway = {
    ...giveaway,
    closedAt: '2026-07-03T10:01:00.000Z',
    closedByUserId: 'actor-1',
    status: 'closed' as const,
    updatedAt: '2026-07-03T10:01:00.000Z',
};
const entry = {
    enteredAt: '2026-07-03T08:10:00.000Z',
    giveawayId: 'giveaway-1',
    id: 'entry-1',
    removedAt: null,
    userId: 'user-1',
};
const removedEntry = {
    ...entry,
    removedAt: '2026-07-03T08:30:00.000Z',
};
const winner = {
    drawNumber: 1,
    giveawayId: 'giveaway-1',
    id: 'winner-1',
    selectedAt: '2026-07-03T10:01:00.000Z',
    userId: 'user-1',
};
const event = {
    actorUserId: 'actor-1',
    createdAt: '2026-07-03T10:02:00.000Z',
    details: { reason: 'manual' },
    eventType: 'giveaway.closed',
    giveawayId: 'giveaway-1',
    id: 'event-1',
};

describe('Convex giveaways database functions', () => {
    it('routes giveaway dashboard and bot entry operations through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [
                giveaway,
                closedGiveaway,
                entry,
                removedEntry,
                { giveaway: closedGiveaway, winners: [winner] },
                event,
            ],
            queryResults: [[giveaway], giveaway, giveaway, [entry], [winner], giveaway],
        });

        const created = await createGiveaway(db, {
            channelId: ' channel-1 ',
            config: giveaway.config,
            createdByUserId: ' creator-1 ',
            description: ' Daily giveaway ',
            endsAt: new Date(giveaway.endsAt),
            entryEmoji: ' 🎉 ',
            guildId: ' guild-1 ',
            messageId: ' message-1 ',
            prize: ' Nitro ',
            status: 'active',
            title: ' Daily Nitro ',
            winnerCount: 2,
        });
        const listed = await listGiveawaysByGuildId(db, { guildId: ' guild-1 ', limit: 10 });
        const found = await findActiveGiveawayByGuildMessageId(db, { guildId: ' guild-1 ', messageId: ' message-1 ' });
        const closed = await updateGiveawayStatus(db, {
            actorUserId: ' actor-1 ',
            giveawayId: ' giveaway-1 ',
            guildId: ' guild-1 ',
            status: ' closed ',
        });
        const addedEntry = await upsertGiveawayEntry(db, { giveawayId: ' giveaway-1 ', userId: ' user-1 ' });
        const deletedEntry = await removeGiveawayEntry(db, { giveawayId: ' giveaway-1 ', userId: ' user-1 ' });
        const entries = await listActiveGiveawayEntries(db, { giveawayId: ' giveaway-1 ' });
        const winners = await listGiveawayWinners(db, { giveawayId: ' giveaway-1 ' });
        const draw = await drawGiveawayWinners(db, {
            actorUserId: ' actor-1 ',
            giveawayId: ' giveaway-1 ',
            guildId: ' guild-1 ',
        });
        const recordedEvent = await recordGiveawayEvent(db, {
            actorUserId: ' actor-1 ',
            details: event.details,
            eventType: ' giveaway.closed ',
            giveawayId: ' giveaway-1 ',
        });

        expect(created._unsafeUnwrap()).toStrictEqual(toGiveawayRecord(giveaway));
        expect(listed._unsafeUnwrap()).toStrictEqual([toGiveawayRecord(giveaway)]);
        expect(found._unsafeUnwrap()).toStrictEqual(toGiveawayRecord(giveaway));
        expect(closed._unsafeUnwrap()).toStrictEqual(toGiveawayRecord(closedGiveaway));
        expect(addedEntry._unsafeUnwrap()).toStrictEqual(toEntryRecord(entry));
        expect(deletedEntry._unsafeUnwrap()).toStrictEqual(toEntryRecord(removedEntry));
        expect(entries._unsafeUnwrap()).toStrictEqual([toEntryRecord(entry)]);
        expect(winners._unsafeUnwrap()).toStrictEqual([toWinnerRecord(winner)]);
        expect(draw._unsafeUnwrap()).toStrictEqual({
            giveaway: toGiveawayRecord(closedGiveaway),
            winners: [toWinnerRecord(winner)],
        });
        expect(recordedEvent._unsafeUnwrap()).toStrictEqual(toEventRecord(event));
        expect(db.client.mutationCalls[0]?.args).toMatchObject({
            channelId: 'channel-1',
            guildId: 'guild-1',
            prize: 'Nitro',
            title: 'Daily Nitro',
            winnerCount: 2,
        });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({ guildId: 'guild-1', limit: 10 });
    });

    it('routes maintenance and reconciliation operations through Convex', async () => {
        const activeGiveaway = { ...giveaway, config: { syncStatus: 'active' } };
        const db = createConvexDb({
            mutationResults: [activeGiveaway, { added: 1, kept: 2, removed: 1 }],
            queryResults: [[giveaway], [giveaway], [giveaway]],
        });

        const expired = await listExpiredActiveGiveaways(db, { limit: 5, now: new Date('2026-07-03T11:00:00.000Z') });
        const stale = await listStaleActiveGiveaways(db, { limit: 6 });
        const reconciliationTargets = await listReactionReconciliationGiveaways(db, { limit: 7 });
        const synced = await updateGiveawaySyncStatus(db, {
            giveawayId: ' giveaway-1 ',
            guildId: ' guild-1 ',
            syncStatus: 'active',
        });
        const reconciled = await reconcileGiveawayEntries(db, {
            giveawayId: ' giveaway-1 ',
            reconciledAt: new Date('2026-07-03T11:15:00.000Z'),
            userIds: [' user-1 ', 'user-2', 'user-1', ' '],
        });

        expect(expired._unsafeUnwrap()).toStrictEqual([toGiveawayRecord(giveaway)]);
        expect(stale._unsafeUnwrap()).toStrictEqual([toGiveawayRecord(giveaway)]);
        expect(reconciliationTargets._unsafeUnwrap()).toStrictEqual([toGiveawayRecord(giveaway)]);
        expect(synced._unsafeUnwrap()).toStrictEqual(toGiveawayRecord(activeGiveaway));
        expect(reconciled._unsafeUnwrap()).toStrictEqual({ added: 1, kept: 2, removed: 1 });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({
            limit: 5,
            now: '2026-07-03T11:00:00.000Z',
        });
        expect(db.client.mutationCalls[1]?.args).toStrictEqual({
            giveawayId: 'giveaway-1',
            reconciledAt: '2026-07-03T11:15:00.000Z',
            userIds: ['user-1', 'user-2', 'user-1'],
        });
    });

    it('maps validation, missing records, and invalid transitions to existing errors', async () => {
        const draftGiveaway = { ...giveaway, status: 'draft' as const };
        const db = createConvexDb({
            mutationResults: [null],
            queryResults: [draftGiveaway],
        });

        const invalidWinnerCount = await createGiveaway(db, {
            channelId: 'channel-1',
            guildId: 'guild-1',
            prize: 'Nitro',
            title: 'Daily Nitro',
            winnerCount: 26,
        });
        const invalidDate = await listExpiredActiveGiveaways(db, { now: new Date('bad') });
        const invalidTransition = await updateGiveawayStatus(db, {
            giveawayId: 'giveaway-1',
            guildId: 'guild-1',
            status: 'closed',
        });
        const missingEntry = await removeGiveawayEntry(db, { giveawayId: 'giveaway-1', userId: 'user-1' });

        expect(invalidWinnerCount._unsafeUnwrapErr()).toStrictEqual({ field: 'winnerCount', type: 'invalid-value' });
        expect(invalidDate._unsafeUnwrapErr()).toStrictEqual({ field: 'now', type: 'invalid-value' });
        expect(invalidTransition._unsafeUnwrapErr()).toStrictEqual({
            from: 'draft',
            to: 'closed',
            type: 'invalid-status-transition',
        });
        expect(missingEntry._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(db.client.mutationCalls).toHaveLength(1);
    });
});

function toGiveawayRecord(record: typeof giveaway | typeof closedGiveaway) {
    return {
        ...record,
        closedAt: record.closedAt ? new Date(record.closedAt) : null,
        createdAt: new Date(record.createdAt),
        endsAt: record.endsAt ? new Date(record.endsAt) : null,
        updatedAt: new Date(record.updatedAt),
    };
}

function toEntryRecord(record: typeof entry | typeof removedEntry) {
    return {
        ...record,
        enteredAt: new Date(record.enteredAt),
        removedAt: record.removedAt ? new Date(record.removedAt) : null,
    };
}

function toWinnerRecord(record: typeof winner) {
    return { ...record, selectedAt: new Date(record.selectedAt) };
}

function toEventRecord(record: typeof event) {
    return { ...record, createdAt: new Date(record.createdAt) };
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
        serviceName: 'bot',
    };
}
