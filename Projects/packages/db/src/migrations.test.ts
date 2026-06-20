import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from './client.js';
import { databaseMigrationLockKey, runDatabaseMigrations } from './migrations.js';

type FakeLockClient = {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
};

function createFakeClient(lockClient: FakeLockClient): {
    client: DatabaseClient;
    connect: ReturnType<typeof vi.fn>;
} {
    const connect = vi.fn(() => Promise.resolve(lockClient));
    const client = {
        db: {} as DatabaseClient['db'],
        pool: {
            connect,
        } as unknown as DatabaseClient['pool'],
        close: vi.fn(),
    };

    return { client, connect };
}

function createFakeLockClient(): FakeLockClient {
    return {
        query: vi.fn(() => Promise.resolve({ rows: [] })),
        release: vi.fn(),
    };
}

describe('runDatabaseMigrations', () => {
    it('skips migration work when auto migration is disabled', async () => {
        const lockClient = createFakeLockClient();
        const { client, connect } = createFakeClient(lockClient);
        const migrate = vi.fn();

        const result = await runDatabaseMigrations(client, {
            autoMigrate: false,
            migrate,
        });

        expect(result.status).toBe('skipped');
        expect(connect).not.toHaveBeenCalled();
        expect(migrate).not.toHaveBeenCalled();
    });

    it('runs migrations while holding the Postgres advisory lock', async () => {
        const lockClient = createFakeLockClient();
        const { client } = createFakeClient(lockClient);
        const migrate = vi.fn(() => Promise.resolve());
        const migrationsFolder = 'test-migrations';

        const result = await runDatabaseMigrations(client, {
            migrationsFolder,
            migrate,
        });

        expect(result).toEqual({
            status: 'applied',
            migrationsFolder,
        });
        expect(lockClient.query).toHaveBeenNthCalledWith(1, 'select pg_advisory_lock($1::integer, $2::integer);', [
            databaseMigrationLockKey.namespace,
            databaseMigrationLockKey.key,
        ]);
        expect(migrate).toHaveBeenCalledWith(client.db, { migrationsFolder });
        expect(lockClient.query).toHaveBeenNthCalledWith(2, 'select pg_advisory_unlock($1::integer, $2::integer);', [
            databaseMigrationLockKey.namespace,
            databaseMigrationLockKey.key,
        ]);
        expect(lockClient.release).toHaveBeenCalledOnce();
    });

    it('unlocks and releases the lock client when migration fails', async () => {
        const lockClient = createFakeLockClient();
        const { client } = createFakeClient(lockClient);
        const error = new Error('migration failed');
        const migrate = vi.fn(() => Promise.reject(error));

        await expect(
            runDatabaseMigrations(client, {
                migrate,
            })
        ).rejects.toThrow(error);

        expect(lockClient.query).toHaveBeenNthCalledWith(2, 'select pg_advisory_unlock($1::integer, $2::integer);', [
            databaseMigrationLockKey.namespace,
            databaseMigrationLockKey.key,
        ]);
        expect(lockClient.release).toHaveBeenCalledOnce();
    });

    it('uses the package drizzle folder by default', async () => {
        const lockClient = createFakeLockClient();
        const { client } = createFakeClient(lockClient);
        const migrate = vi.fn(() => Promise.resolve());

        const result = await runDatabaseMigrations(client, { migrate });

        expect(result.migrationsFolder.replaceAll('\\', '/')).toMatch(/packages\/db\/drizzle$/);
        expect(migrate).toHaveBeenCalledWith(client.db, {
            migrationsFolder: result.migrationsFolder,
        });
    });
});
