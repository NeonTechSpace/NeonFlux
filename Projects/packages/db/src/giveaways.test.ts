import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    createGiveaway,
    drawGiveawayWinners,
    findActiveGiveawayByGuildMessageId,
    findGiveawayById,
    listActiveGiveawayEntries,
    listGiveawayWinners,
    listGiveawaysByGuildId,
    readGiveawayEntryCount,
    recordGiveawayEvent,
    removeGiveawayEntry,
    updateGiveawayStatus,
    upsertGiveawayEntry,
} from './giveaways.js';
import { reconcileGiveawayEntries } from './giveaway-reconciliation.js';
import {
    listExpiredActiveGiveaways,
    listReactionReconciliationGiveaways,
    listStaleActiveGiveaways,
    updateGiveawaySyncStatus,
} from './giveaway-maintenance.js';
import { upsertGuild } from './guilds.js';
import * as schema from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-giveaways-test');

let testDatabase: TestDatabase | undefined;

describe('giveaway repository', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('creates, lists, and finds guild-scoped giveaways', async () => {
        const giveaway = await createDefaultGiveaway({ status: 'active' });
        await expectOk(
            createGiveaway(getDb(), {
                guildId: 'guild-2',
                channelId: 'channel-2',
                title: 'Other',
                prize: 'Other prize',
                status: 'active',
            })
        );

        const listed = await expectOk(listGiveawaysByGuildId(getDb(), { guildId: 'guild-1' }));
        const byId = await expectOk(findGiveawayById(getDb(), { guildId: 'guild-1', giveawayId: giveaway.id }));
        const byMessage = await expectOk(
            findActiveGiveawayByGuildMessageId(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
            })
        );

        expect(listed.map((record) => record.id)).toStrictEqual([giveaway.id]);
        expect(byId.prize).toBe('Nitro');
        expect(byMessage.id).toBe(giveaway.id);
    });

    it('upserts and removes giveaway entries idempotently', async () => {
        const giveaway = await createDefaultGiveaway({ status: 'active' });
        const firstEntry = await expectOk(
            upsertGiveawayEntry(getDb(), {
                giveawayId: giveaway.id,
                userId: 'user-1',
            })
        );
        await expectOk(
            upsertGiveawayEntry(getDb(), {
                giveawayId: giveaway.id,
                userId: 'user-1',
            })
        );
        await expectOk(
            upsertGiveawayEntry(getDb(), {
                giveawayId: giveaway.id,
                userId: 'user-2',
            })
        );

        const removed = await expectOk(
            removeGiveawayEntry(getDb(), {
                giveawayId: giveaway.id,
                userId: 'user-1',
            })
        );
        const entries = await expectOk(listActiveGiveawayEntries(getDb(), { giveawayId: giveaway.id }));
        const count = await expectOk(readGiveawayEntryCount(getDb(), { giveawayId: giveaway.id }));

        expect(removed.id).toBe(firstEntry.id);
        expect(entries.map((entry) => entry.userId)).toStrictEqual(['user-2']);
        expect(count).toBe(1);
    });

    it('reconciles active entries from reaction users', async () => {
        const giveaway = await createDefaultGiveaway({ status: 'active' });
        await enterUsers(giveaway.id, ['keep-user', 'remove-user']);

        const result = await expectOk(
            reconcileGiveawayEntries(getDb(), {
                giveawayId: giveaway.id,
                userIds: ['keep-user', 'add-user', 'add-user'],
                reconciledAt: new Date('2026-06-26T12:00:00.000Z'),
            })
        );
        const entries = await expectOk(listActiveGiveawayEntries(getDb(), { giveawayId: giveaway.id }));
        const updated = await expectOk(findGiveawayById(getDb(), { guildId: 'guild-1', giveawayId: giveaway.id }));

        expect(result).toStrictEqual({ added: 1, removed: 1, kept: 1 });
        expect(entries.map((entry) => entry.userId).sort()).toStrictEqual(['add-user', 'keep-user']);
        expect(updated.config).toMatchObject({
            reactionReconciledAt: '2026-06-26T12:00:00.000Z',
        });
    });

    it('closes active giveaways and records winner draw events', async () => {
        const giveaway = await createDefaultGiveaway({ status: 'active', winnerCount: 2 });
        await enterUsers(giveaway.id, ['user-1', 'user-2', 'user-3']);

        const result = await expectOk(
            drawGiveawayWinners(getDb(), {
                guildId: 'guild-1',
                giveawayId: giveaway.id,
                actorUserId: 'actor-1',
            })
        );
        const winners = await expectOk(listGiveawayWinners(getDb(), { giveawayId: giveaway.id }));
        const closedGiveaway = await expectOk(
            findGiveawayById(getDb(), { guildId: 'guild-1', giveawayId: giveaway.id })
        );

        expect(result.giveaway.status).toBe('closed');
        expect(result.winners).toHaveLength(2);
        expect(new Set(result.winners.map((winner) => winner.userId)).size).toBe(2);
        expect(winners).toHaveLength(2);
        expect(closedGiveaway.status).toBe('closed');
        expect(closedGiveaway.closedByUserId).toBe('actor-1');
        expect(closedGiveaway.closedAt).toBeInstanceOf(Date);
    });

    it('returns an existing first draw when closing an already closed giveaway', async () => {
        const giveaway = await createDefaultGiveaway({ status: 'active', winnerCount: 1 });
        await enterUsers(giveaway.id, ['user-1', 'user-2']);
        const firstClose = await expectOk(
            drawGiveawayWinners(getDb(), {
                guildId: 'guild-1',
                giveawayId: giveaway.id,
            })
        );
        const secondClose = await expectOk(
            drawGiveawayWinners(getDb(), {
                guildId: 'guild-1',
                giveawayId: giveaway.id,
            })
        );
        const persistedWinners = await expectOk(listGiveawayWinners(getDb(), { giveawayId: giveaway.id }));

        expect(secondClose.winners.map((winner) => winner.userId)).toStrictEqual(
            firstClose.winners.map((winner) => winner.userId)
        );
        expect(persistedWinners).toHaveLength(1);
    });

    it('rerolls closed giveaways without picking previous winners when enough entries exist', async () => {
        const giveaway = await createDefaultGiveaway({ status: 'active', winnerCount: 1 });
        await enterUsers(giveaway.id, ['user-1', 'user-2']);
        const firstDraw = await expectOk(
            drawGiveawayWinners(getDb(), {
                guildId: 'guild-1',
                giveawayId: giveaway.id,
            })
        );

        const reroll = await expectOk(
            drawGiveawayWinners(getDb(), {
                guildId: 'guild-1',
                giveawayId: giveaway.id,
                actorUserId: 'actor-1',
                reroll: true,
            })
        );

        expect(reroll.giveaway.status).toBe('closed');
        expect(reroll.winners).toHaveLength(1);
        expect(reroll.winners[0]?.drawNumber).toBe(2);
        expect(reroll.winners[0]?.userId).not.toBe(firstDraw.winners[0]?.userId);
    });

    it('cancels active giveaways and records custom events', async () => {
        const giveaway = await createDefaultGiveaway({ status: 'active' });
        const cancelled = await expectOk(
            updateGiveawayStatus(getDb(), {
                guildId: 'guild-1',
                giveawayId: giveaway.id,
                status: 'cancelled',
                actorUserId: 'actor-1',
            })
        );
        const event = await expectOk(
            recordGiveawayEvent(getDb(), {
                giveawayId: giveaway.id,
                eventType: 'cancelled',
                actorUserId: 'actor-1',
            })
        );

        expect(cancelled.status).toBe('cancelled');
        expect(cancelled.closedByUserId).toBe('actor-1');
        expect(event.eventType).toBe('cancelled');
    });

    it('lists expired active giveaways and stale reaction sync records', async () => {
        const expired = await createDefaultGiveaway({
            messageId: 'expired-message',
            status: 'active',
            endsAt: new Date('2026-06-26T09:00:00.000Z'),
            config: { syncStatus: 'stale' },
        });
        await createDefaultGiveaway({
            messageId: 'future-message',
            status: 'active',
            endsAt: new Date('2026-06-26T11:00:00.000Z'),
            config: { syncStatus: 'stale' },
        });
        await createDefaultGiveaway({
            messageId: 'cancelled-message',
            status: 'cancelled',
            endsAt: new Date('2026-06-26T08:00:00.000Z'),
            config: { syncStatus: 'stale' },
        });

        const expiredGiveaways = await expectOk(
            listExpiredActiveGiveaways(getDb(), {
                now: new Date('2026-06-26T10:00:00.000Z'),
            })
        );
        const staleGiveaways = await expectOk(listStaleActiveGiveaways(getDb()));
        const reconcilableGiveaways = await expectOk(listReactionReconciliationGiveaways(getDb()));
        const repaired = await expectOk(
            updateGiveawaySyncStatus(getDb(), {
                guildId: 'guild-1',
                giveawayId: expired.id,
                syncStatus: 'active',
            })
        );

        expect(expiredGiveaways.map((giveaway) => giveaway.id)).toStrictEqual([expired.id]);
        expect(new Set(staleGiveaways.map((giveaway) => giveaway.messageId))).toStrictEqual(
            new Set(['expired-message', 'future-message'])
        );
        expect(new Set(reconcilableGiveaways.map((giveaway) => giveaway.messageId))).toStrictEqual(
            new Set(['expired-message', 'future-message'])
        );
        expect(repaired.config).toMatchObject({ syncStatus: 'active' });
    });

    it('rejects invalid input and illegal transitions', async () => {
        const missing = await createGiveaway(getDb(), {
            guildId: '',
            channelId: 'channel-1',
            title: 'Launch',
            prize: 'Nitro',
        });
        const giveaway = await createDefaultGiveaway({ status: 'cancelled' });
        const transition = await updateGiveawayStatus(getDb(), {
            guildId: 'guild-1',
            giveawayId: giveaway.id,
            status: 'closed',
        });

        expect(missing._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'guildId' });
        expect(transition._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-status-transition',
            from: 'cancelled',
            to: 'closed',
        });
    });
});

async function createDefaultGiveaway(overrides: Partial<Parameters<typeof createGiveaway>[1]> = {}) {
    return expectOk(
        createGiveaway(getDb(), {
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
            title: 'Launch giveaway',
            prize: 'Nitro',
            winnerCount: 1,
            status: 'draft',
            ...overrides,
        })
    );
}

async function enterUsers(giveawayId: string, userIds: readonly string[]): Promise<void> {
    for (const userId of userIds) {
        await expectOk(upsertGiveawayEntry(getDb(), { giveawayId, userId }));
    }
}

async function createTestDatabase(): Promise<TestDatabase> {
    await mkdir(testDataRoot, { recursive: true });
    const dataDirectory = join(testDataRoot, randomUUID());
    const client = new PGlite(dataDirectory);
    const db = drizzle(client, { schema });

    await migrate(db, { migrationsFolder });

    return {
        db,
        async close() {
            await client.close();
            await rm(dataDirectory, { recursive: true, force: true });
        },
    };
}

function getDb() {
    if (!testDatabase) {
        throw new Error('Test database was not created.');
    }

    return testDatabase.db;
}

async function expectOk<T>(resultPromise: Promise<{ isOk(): boolean; _unsafeUnwrap(): T }>): Promise<T> {
    const result = await resultPromise;

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

type TestDatabase = {
    db: ReturnType<typeof drizzle<typeof schema>>;
    close: () => Promise<void>;
};
