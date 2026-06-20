import { fileURLToPath } from 'node:url';

import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';

import type { DatabaseClient } from './client.js';

const defaultMigrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export const databaseMigrationLockKey = {
    namespace: 0x4e464c58,
    key: 0x44424d47,
} as const;

export type DatabaseMigrationStatus = 'applied' | 'skipped';

export type RunDatabaseMigrationsResult = {
    status: DatabaseMigrationStatus;
    migrationsFolder: string;
};

type MigrationExecutor = (
    db: DatabaseClient['db'],
    options: {
        migrationsFolder: string;
    }
) => Promise<void>;

export type RunDatabaseMigrationsOptions = {
    autoMigrate?: boolean;
    migrationsFolder?: string;
    migrate?: MigrationExecutor;
};

export async function runDatabaseMigrations(
    client: DatabaseClient,
    options: RunDatabaseMigrationsOptions = {}
): Promise<RunDatabaseMigrationsResult> {
    const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder;

    if (options.autoMigrate === false) {
        return {
            status: 'skipped',
            migrationsFolder,
        };
    }

    const migrate = options.migrate ?? drizzleMigrate;
    const lockClient = await client.pool.connect();
    let failure: unknown;
    let locked = false;

    try {
        await lockClient.query('select pg_advisory_lock($1::integer, $2::integer);', [
            databaseMigrationLockKey.namespace,
            databaseMigrationLockKey.key,
        ]);
        locked = true;

        await migrate(client.db, { migrationsFolder });
    } catch (error) {
        failure = error;
    } finally {
        if (locked) {
            try {
                await lockClient.query('select pg_advisory_unlock($1::integer, $2::integer);', [
                    databaseMigrationLockKey.namespace,
                    databaseMigrationLockKey.key,
                ]);
            } catch (error) {
                failure ??= error;
            }
        }

        lockClient.release();
    }

    if (failure) {
        throw normalizeMigrationError(failure);
    }

    return {
        status: 'applied',
        migrationsFolder,
    };
}

function normalizeMigrationError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
