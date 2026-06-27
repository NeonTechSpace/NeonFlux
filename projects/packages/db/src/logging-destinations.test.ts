import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { upsertGuild } from './guilds.js';
import {
    deleteGuildLoggingDestination,
    findGuildLoggingDestinationByEventGroup,
    listGuildLoggingDestinationsByGuildId,
    upsertGuildLoggingDestination,
} from './logging-destinations.js';
import * as schema from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-logging-destinations-test');

let testDatabase: TestDatabase | undefined;

describe('logging destination repository', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('upserts and lists guild-scoped logging destinations', async () => {
        await expectOk(
            upsertGuildLoggingDestination(getDb(), {
                guildId: 'guild-1',
                eventGroup: 'messages',
                channelId: 'channel-a',
            })
        );
        const updated = await expectOk(
            upsertGuildLoggingDestination(getDb(), {
                guildId: 'guild-1',
                eventGroup: 'messages',
                channelId: 'channel-b',
                enabled: false,
            })
        );
        await expectOk(
            upsertGuildLoggingDestination(getDb(), {
                guildId: 'guild-1',
                eventGroup: 'members',
                channelId: 'channel-c',
            })
        );
        await expectOk(
            upsertGuildLoggingDestination(getDb(), {
                guildId: 'guild-2',
                eventGroup: 'messages',
                channelId: 'other-guild-channel',
            })
        );

        const all = await expectOk(listGuildLoggingDestinationsByGuildId(getDb(), { guildId: 'guild-1' }));
        const enabled = await expectOk(
            listGuildLoggingDestinationsByGuildId(getDb(), { guildId: 'guild-1', enabled: true })
        );

        expect(updated).toMatchObject({
            guildId: 'guild-1',
            eventGroup: 'messages',
            channelId: 'channel-b',
            enabled: false,
        });
        expect(all.map((destination) => [destination.eventGroup, destination.channelId])).toStrictEqual([
            ['members', 'channel-c'],
            ['messages', 'channel-b'],
        ]);
        expect(enabled.map((destination) => destination.eventGroup)).toStrictEqual(['members']);
    });

    it('finds and deletes one destination by event group', async () => {
        await expectOk(
            upsertGuildLoggingDestination(getDb(), {
                guildId: 'guild-1',
                eventGroup: 'channels',
                channelId: 'channel-a',
            })
        );

        const found = await expectOk(
            findGuildLoggingDestinationByEventGroup(getDb(), {
                guildId: 'guild-1',
                eventGroup: 'channels',
            })
        );
        const deleted = await expectOk(
            deleteGuildLoggingDestination(getDb(), {
                guildId: 'guild-1',
                eventGroup: 'channels',
            })
        );
        const missing = await findGuildLoggingDestinationByEventGroup(getDb(), {
            guildId: 'guild-1',
            eventGroup: 'channels',
        });

        expect(found.channelId).toBe('channel-a');
        expect(deleted.id).toBe(found.id);
        expect(missing.isErr()).toBe(true);
        expect(missing._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('rejects invalid logging destination input', async () => {
        const result = await upsertGuildLoggingDestination(getDb(), {
            guildId: 'guild-1',
            eventGroup: 'posting',
            channelId: 'channel-a',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'eventGroup',
        });
    });
});

async function expectOk<TValue>(promise: Promise<{ isOk(): boolean; _unsafeUnwrap(): TValue }>): Promise<TValue> {
    const result = await promise;

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

function getDb(): TestDatabase['db'] {
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
