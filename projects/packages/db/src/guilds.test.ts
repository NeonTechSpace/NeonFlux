import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import { findGuildById, listGuildIds, upsertGuild } from './guilds.js';

let testDatabase: TestDatabase | undefined;

beforeAll(async () => {
    testDatabase = await createTestDatabase();
});

beforeEach(async () => {
    await resetTestDatabase();
});

afterAll(async () => {
    await testDatabase?.close();
    testDatabase = undefined;
});

describe('guild repository', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('upserts a durable guild and preserves firstSeenAt', async () => {
        const firstUpdatedAt = new Date('2026-06-26T08:00:00.000Z');
        const secondUpdatedAt = new Date('2026-06-26T09:00:00.000Z');

        vi.useFakeTimers();
        vi.setSystemTime(firstUpdatedAt);
        const first = await upsert(getDb(), ' guild-1 ');

        vi.setSystemTime(secondUpdatedAt);
        const second = await upsert(getDb(), 'guild-1');

        expect(first).toMatchObject({
            guildId: 'guild-1',
            updatedAt: firstUpdatedAt,
        });
        expect(second).toMatchObject({
            guildId: 'guild-1',
            firstSeenAt: first.firstSeenAt,
            updatedAt: secondUpdatedAt,
        });
    });

    it('finds and lists durable guilds', async () => {
        await upsert(getDb(), 'guild-b');
        await upsert(getDb(), 'guild-a');

        const found = await findGuildById(getDb(), { guildId: ' guild-a ' });
        const guildIds = await listGuildIds(getDb());

        expect(found.isOk()).toBe(true);
        expect(found._unsafeUnwrap()).toMatchObject({ guildId: 'guild-a' });
        expect(guildIds.isOk()).toBe(true);
        expect(guildIds._unsafeUnwrap()).toStrictEqual(['guild-a', 'guild-b']);
    });

    it('rejects blank guild ids', async () => {
        const upsertResult = await upsertGuild(getDb(), { guildId: '   ' });
        const findResult = await findGuildById(getDb(), { guildId: '   ' });

        expect(upsertResult.isErr()).toBe(true);
        expect(upsertResult._unsafeUnwrapErr()).toBe('missing-guild-id');
        expect(findResult.isErr()).toBe(true);
        expect(findResult._unsafeUnwrapErr()).toBe('missing-guild-id');
    });
});

async function upsert(db: Parameters<typeof upsertGuild>[0], guildId: string) {
    const result = await upsertGuild(db, { guildId });

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

async function resetTestDatabase(): Promise<void> {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    await testDatabase.reset();
}

function getDb(): Parameters<typeof upsertGuild>[0] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = PgliteTestDatabase;

function createTestDatabase(): Promise<TestDatabase> {
    return createPgliteTestDatabase('guilds');
}
