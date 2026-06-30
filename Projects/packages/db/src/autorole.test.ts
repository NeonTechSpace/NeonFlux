import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import {
    deleteAutoroleRule,
    listAutoroleRulesByGuildId,
    listEnabledAutoroleRulesByGuildId,
    upsertAutoroleRule,
} from './autorole.js';
import { upsertGuild } from './guilds.js';

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

describe('autorole repository', () => {
    beforeEach(async () => {
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    it('upserts and lists guild-scoped autorole rules', async () => {
        const created = await expectOk(
            upsertAutoroleRule(getDb(), {
                guildId: 'guild-1',
                roleId: 'role-1',
                name: 'Member',
            })
        );
        const updated = await expectOk(
            upsertAutoroleRule(getDb(), {
                guildId: 'guild-1',
                roleId: 'role-1',
                name: 'Verified Member',
                enabled: false,
            })
        );
        await expectOk(
            upsertAutoroleRule(getDb(), {
                guildId: 'guild-1',
                roleId: 'role-2',
                name: 'Visitor',
            })
        );
        await expectOk(
            upsertAutoroleRule(getDb(), {
                guildId: 'guild-2',
                roleId: 'role-1',
                name: 'Other Guild Member',
            })
        );

        const all = await expectOk(listAutoroleRulesByGuildId(getDb(), { guildId: 'guild-1' }));
        const enabled = await expectOk(listEnabledAutoroleRulesByGuildId(getDb(), { guildId: 'guild-1' }));

        expect(updated.id).toBe(created.id);
        expect(all.map((rule) => [rule.roleId, rule.name, rule.enabled])).toStrictEqual([
            ['role-1', 'Verified Member', false],
            ['role-2', 'Visitor', true],
        ]);
        expect(enabled.map((rule) => rule.roleId)).toStrictEqual(['role-2']);
    });

    it('deletes one autorole rule by guild and role', async () => {
        const created = await expectOk(
            upsertAutoroleRule(getDb(), {
                guildId: 'guild-1',
                roleId: 'role-1',
                name: 'Member',
            })
        );

        const deleted = await expectOk(
            deleteAutoroleRule(getDb(), {
                guildId: 'guild-1',
                roleId: 'role-1',
            })
        );
        const missing = await deleteAutoroleRule(getDb(), {
            guildId: 'guild-1',
            roleId: 'role-1',
        });

        expect(deleted.id).toBe(created.id);
        expect(missing.isErr()).toBe(true);
        expect(missing._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('rejects blank autorole input', async () => {
        const result = await upsertAutoroleRule(getDb(), {
            guildId: 'guild-1',
            roleId: ' ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'roleId',
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
    return createPgliteTestDatabase('autorole');
}
