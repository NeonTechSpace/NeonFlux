import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import {
    deleteBotInstallation,
    listBotInstallationGuildIds,
    upsertBotInstallation,
    type BotInstallationRecord,
} from './bot-installations.js';
import { findGuildById } from './guilds.js';

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

describe('upsertBotInstallation', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('upserts a new installation and returns normalized camelCase fields', async () => {
        const installation = await upsertInstallation(' guild-1 ');
        const guild = await findGuildById(getDb(), { guildId: 'guild-1' });

        expect(installation).toMatchObject({
            guildId: 'guild-1',
        });
        expect(installation.installedAt).toBeInstanceOf(Date);
        expect(installation.updatedAt).toBeInstanceOf(Date);
        expect(guild.isOk()).toBe(true);
        expect(guild._unsafeUnwrap()).toMatchObject({
            guildId: 'guild-1',
        });
    });

    it('preserves installedAt and updates updatedAt when upserting the same guild', async () => {
        const firstUpdatedAt = new Date('2026-06-21T00:00:00.000Z');
        const secondUpdatedAt = new Date('2026-06-22T00:00:00.000Z');

        vi.useFakeTimers();
        vi.setSystemTime(firstUpdatedAt);
        const firstInstallation = await upsertInstallation('guild-1');

        vi.setSystemTime(secondUpdatedAt);
        const secondInstallation = await upsertInstallation('guild-1');

        expect(secondInstallation).toMatchObject({
            guildId: 'guild-1',
            installedAt: firstInstallation.installedAt,
            updatedAt: secondUpdatedAt,
        });
    });

    it('rejects a blank guild id', async () => {
        const result = await upsertBotInstallation(getDb(), {
            guildId: '   ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-guild-id');
    });
});

describe('listBotInstallationGuildIds', () => {
    it('lists installed guild IDs sorted by guild id', async () => {
        await upsertInstallation('guild-c');
        await upsertInstallation('guild-a');
        await upsertInstallation('guild-b');

        const result = await listBotInstallationGuildIds(getDb());

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual(['guild-a', 'guild-b', 'guild-c']);
    });
});

describe('deleteBotInstallation', () => {
    it('deletes an existing installation', async () => {
        await upsertInstallation('guild-1');

        const result = await deleteBotInstallation(getDb(), {
            guildId: ' guild-1 ',
        });
        const remainingGuildIds = await listBotInstallationGuildIds(getDb());

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({
            guildId: 'guild-1',
        });
        expect(remainingGuildIds.isOk()).toBe(true);
        expect(remainingGuildIds._unsafeUnwrap()).toStrictEqual([]);
    });

    it('preserves the durable guild record when deleting an installation', async () => {
        await upsertInstallation('guild-1');

        await deleteBotInstallation(getDb(), {
            guildId: 'guild-1',
        });

        const guild = await findGuildById(getDb(), { guildId: 'guild-1' });

        expect(guild.isOk()).toBe(true);
        expect(guild._unsafeUnwrap()).toMatchObject({
            guildId: 'guild-1',
        });
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

async function upsertInstallation(guildId: string): Promise<BotInstallationRecord> {
    const result = await upsertBotInstallation(getDb(), {
        guildId,
    });

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

async function resetTestDatabase(): Promise<void> {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    await testDatabase.reset();
}

function getDb(): Parameters<typeof upsertBotInstallation>[0] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = PgliteTestDatabase;

function createTestDatabase(): Promise<TestDatabase> {
    return createPgliteTestDatabase('bot-installations');
}
