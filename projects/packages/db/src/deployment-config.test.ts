import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findDeploymentConfig, upsertDeploymentConfig, type DeploymentConfigRecord } from './deployment-config.js';
import * as schema from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-deployment-config-test');

let testDatabase: TestDatabase | undefined;

describe('upsertDeploymentConfig', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('stores single-instance deployment config with the configured guild', async () => {
        const config = await upsertConfig({
            instanceMode: 'single',
            singleGuildId: ' guild-1 ',
            publicWebUrl: ' https://neonflux.example ',
            ownerIds: [' owner-a ', '', 'owner-b'],
        });

        expect(config).toStrictEqual({
            instanceMode: 'single',
            singleGuildId: 'guild-1',
            publicWebUrl: 'https://neonflux.example',
            ownerIds: ['owner-a', 'owner-b'],
        });
    });

    it('stores multi-instance deployment config without a configured guild', async () => {
        const config = await upsertConfig({
            instanceMode: 'multi',
            singleGuildId: 'guild-ignored',
            ownerIds: ['owner-a'],
        });

        expect(config).toStrictEqual({
            instanceMode: 'multi',
            publicWebUrl: null,
            ownerIds: ['owner-a'],
        });
    });

    it('requires single-instance deployment config to include a guild id', async () => {
        const result = await upsertDeploymentConfig(getDb(), {
            instanceMode: 'single',
            singleGuildId: '   ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-single-guild-id');
    });

    it('rejects invalid instance modes', async () => {
        const result = await upsertDeploymentConfig(getDb(), {
            instanceMode: 'staging',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-instance-mode');
    });

    it('replaces the fixed deployment config row on upsert', async () => {
        await upsertConfig({
            instanceMode: 'single',
            singleGuildId: 'guild-1',
            ownerIds: ['owner-a'],
        });

        const updatedConfig = await upsertConfig({
            instanceMode: 'multi',
            publicWebUrl: 'https://neonflux.example',
            ownerIds: ['owner-b'],
        });
        const storedConfig = await findDeploymentConfig(getDb());

        expect(updatedConfig).toStrictEqual({
            instanceMode: 'multi',
            publicWebUrl: 'https://neonflux.example',
            ownerIds: ['owner-b'],
        });
        expect(storedConfig.isOk()).toBe(true);
        expect(storedConfig._unsafeUnwrap()).toStrictEqual(updatedConfig);
    });
});

describe('findDeploymentConfig', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('returns not-found before deployment config is initialized', async () => {
        const result = await findDeploymentConfig(getDb());

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('not-found');
    });

    it('loads the initialized deployment config', async () => {
        await upsertConfig({
            instanceMode: 'single',
            singleGuildId: 'guild-1',
            ownerIds: ['owner-a'],
        });

        const result = await findDeploymentConfig(getDb());

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            instanceMode: 'single',
            singleGuildId: 'guild-1',
            publicWebUrl: null,
            ownerIds: ['owner-a'],
        });
    });
});

async function upsertConfig(input: Parameters<typeof upsertDeploymentConfig>[1]): Promise<DeploymentConfigRecord> {
    const result = await upsertDeploymentConfig(getDb(), input);

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

function getDb(): Parameters<typeof upsertDeploymentConfig>[0] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = {
    db: Parameters<typeof upsertDeploymentConfig>[0];
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
