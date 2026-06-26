import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findGuildById, listGuildIds, upsertGuild } from './guilds.js';
import * as schema from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-guilds-test');

let testDatabase: TestDatabase | undefined;

describe('guild repository', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
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

function getDb(): Parameters<typeof upsertGuild>[0] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = {
    db: Parameters<typeof upsertGuild>[0];
    close: () => Promise<void>;
};

async function createTestDatabase(): Promise<TestDatabase> {
    const dataDir = join(testDataRoot, randomUUID());

    await mkdir(dataDir, { recursive: true });

    const client = new PGlite(dataDir);
    const db = drizzle(client, { schema });

    await migrate(db, { migrationsFolder });

    return {
        db,
        async close() {
            await client.close();
            await rm(dataDir, { recursive: true, force: true });
        },
    };
}
