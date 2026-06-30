import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import { upsertGuild } from './guilds.js';
import { findGuildModerationPolicyByGuildId, upsertGuildModerationPolicy } from './moderation-policy.js';
import { guildFeatureSettings } from './schema.js';

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

describe('moderation policy repository', () => {
    beforeEach(async () => {
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
    });

    it('upserts normalized protected users and roles', async () => {
        const created = await expectOk(
            upsertGuildModerationPolicy(getDb(), {
                guildId: ' guild-1 ',
                protectedUserIds: [' user-1 ', '', 'user-1', 'user-2'],
                protectedRoleIds: [' role-1 ', 'role-1'],
            })
        );
        const found = await expectOk(findGuildModerationPolicyByGuildId(getDb(), { guildId: 'guild-1' }));

        expect(created).toMatchObject({
            guildId: 'guild-1',
            protectedUserIds: ['user-1', 'user-2'],
            protectedRoleIds: ['role-1'],
        });
        expect(found).toMatchObject({
            protectedUserIds: ['user-1', 'user-2'],
            protectedRoleIds: ['role-1'],
        });
    });

    it('returns not-found for guilds without moderation policy', async () => {
        const result = await findGuildModerationPolicyByGuildId(getDb(), { guildId: 'guild-1' });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('rejects unreadable stored policy config', async () => {
        await getDb()
            .insert(guildFeatureSettings)
            .values({
                guildId: 'guild-1',
                feature: 'moderation',
                enabled: true,
                config: {
                    protectedUserIds: ['user-1'],
                    protectedRoleIds: 'role-1',
                },
            });

        const result = await findGuildModerationPolicyByGuildId(getDb(), { guildId: 'guild-1' });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-config' });
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
    return createPgliteTestDatabase('moderation-policy');
}
