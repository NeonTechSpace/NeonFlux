import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from './schema.js';
import {
    deleteBotInstallation,
    listBotInstallationGuildIds,
    upsertBotInstallation,
    type BotInstallationRecord,
} from './bot-installations.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-bot-installations-test');

let testDatabase: TestDatabase | undefined;

describe('upsertBotInstallation', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
        vi.useRealTimers();
    });

    it('upserts a new installation and returns normalized camelCase fields', async () => {
        const installation = await upsertInstallation(' guild-1 ', 'multi');

        expect(installation).toMatchObject({
            guildId: 'guild-1',
            mode: 'multi',
        });
        expect(installation.installedAt).toBeInstanceOf(Date);
        expect(installation.updatedAt).toBeInstanceOf(Date);
    });

    it('updates mode and updatedAt when upserting the same guild', async () => {
        const firstUpdatedAt = new Date('2026-06-21T00:00:00.000Z');
        const secondUpdatedAt = new Date('2026-06-22T00:00:00.000Z');

        vi.useFakeTimers();
        vi.setSystemTime(firstUpdatedAt);
        const firstInstallation = await upsertInstallation('guild-1', 'multi');

        vi.setSystemTime(secondUpdatedAt);
        const secondInstallation = await upsertInstallation('guild-1', 'single');

        expect(secondInstallation).toMatchObject({
            guildId: 'guild-1',
            mode: 'single',
            installedAt: firstInstallation.installedAt,
            updatedAt: secondUpdatedAt,
        });
    });

    it('rejects a blank guild id', async () => {
        const result = await upsertBotInstallation(getDb(), {
            guildId: '   ',
            mode: 'multi',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-guild-id');
    });
});

describe('listBotInstallationGuildIds', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('lists installed guild IDs sorted by guild id', async () => {
        await upsertInstallation('guild-c', 'multi');
        await upsertInstallation('guild-a', 'multi');
        await upsertInstallation('guild-b', 'single');

        const result = await listBotInstallationGuildIds(getDb());

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual(['guild-a', 'guild-b', 'guild-c']);
    });
});

describe('deleteBotInstallation', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('deletes an existing installation', async () => {
        await upsertInstallation('guild-1', 'multi');

        const result = await deleteBotInstallation(getDb(), {
            guildId: ' guild-1 ',
        });
        const remainingGuildIds = await listBotInstallationGuildIds(getDb());

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({
            guildId: 'guild-1',
            mode: 'multi',
        });
        expect(remainingGuildIds.isOk()).toBe(true);
        expect(remainingGuildIds._unsafeUnwrap()).toStrictEqual([]);
    });

    it('returns not-found when deleting a missing installation', async () => {
        const result = await deleteBotInstallation(getDb(), {
            guildId: 'guild-missing',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('not-found');
    });

    it('rejects a blank guild id', async () => {
        const result = await deleteBotInstallation(getDb(), {
            guildId: '   ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-guild-id');
    });
});

async function upsertInstallation(
    guildId: string,
    mode: Parameters<typeof upsertBotInstallation>[1]['mode']
): Promise<BotInstallationRecord> {
    const result = await upsertBotInstallation(getDb(), {
        guildId,
        mode,
    });

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

function getDb(): Parameters<typeof upsertBotInstallation>[0] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = {
    db: Parameters<typeof upsertBotInstallation>[0];
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
