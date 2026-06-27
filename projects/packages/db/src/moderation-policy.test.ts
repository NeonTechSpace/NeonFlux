import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { upsertGuild } from './guilds.js';
import { findGuildModerationPolicyByGuildId, upsertGuildModerationPolicy } from './moderation-policy.js';
import * as schema from './schema.js';
import { guildFeatureSettings } from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-moderation-policy-test');

let testDatabase: TestDatabase | undefined;

describe('moderation policy repository', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
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
        close: async () => {
            await client.close();
            await rm(dataDir, { recursive: true, force: true });
        },
    };
}
