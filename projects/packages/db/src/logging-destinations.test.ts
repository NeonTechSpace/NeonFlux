import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import { upsertGuild } from './guilds.js';
import {
    deleteGuildLoggingDestination,
    findGuildLoggingDestinationByEventGroup,
    listGuildLoggingDestinationsByGuildId,
    upsertGuildLoggingDestination,
} from './logging-destinations.js';

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

describe('logging destination repository', () => {
    beforeEach(async () => {
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
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

async function resetTestDatabase(): Promise<void> {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    await testDatabase.reset();
}

function getDb(): TestDatabase['db'] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = PgliteTestDatabase;

function createTestDatabase(): Promise<TestDatabase> {
    return createPgliteTestDatabase('logging-destinations');
}
