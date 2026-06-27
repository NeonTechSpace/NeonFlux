import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    deleteAutoroleRule,
    listAutoroleRulesByGuildId,
    listEnabledAutoroleRulesByGuildId,
    upsertAutoroleRule,
} from './autorole.js';
import { upsertGuild } from './guilds.js';
import * as schema from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-autorole-test');

let testDatabase: TestDatabase | undefined;

describe('autorole repository', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
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
