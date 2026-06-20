import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeWebDatabaseClient, getWebDatabaseClient } from './database.server.js';

const databaseUrl = 'postgres://postgres:postgres@localhost:5432/neonflux_web_test';

afterEach(async () => {
    await closeWebDatabaseClient();
    vi.unstubAllEnvs();
});

describe('getWebDatabaseClient', () => {
    it('creates a DB client from DATABASE_URL', () => {
        vi.stubEnv('APP_ENV', 'development');
        vi.stubEnv('DATABASE_URL', databaseUrl);

        const client = getWebDatabaseClient();

        expect(client.db).toBeDefined();
        expect(client.pool.options.connectionString).toBe(databaseUrl);
    });

    it('returns the same cached client on repeated calls', () => {
        vi.stubEnv('APP_ENV', 'development');
        vi.stubEnv('DATABASE_URL', databaseUrl);

        const firstClient = getWebDatabaseClient();
        const secondClient = getWebDatabaseClient();

        expect(secondClient).toBe(firstClient);
    });

    it('creates a new client after the cached client is closed', async () => {
        vi.stubEnv('APP_ENV', 'development');
        vi.stubEnv('DATABASE_URL', databaseUrl);

        const firstClient = getWebDatabaseClient();

        await closeWebDatabaseClient();

        const secondClient = getWebDatabaseClient();

        expect(secondClient).not.toBe(firstClient);
        expect(secondClient.pool.options.connectionString).toBe(databaseUrl);
    });

    it('throws through config validation when production DATABASE_URL is missing', () => {
        vi.stubEnv('APP_ENV', 'production');
        vi.stubEnv('DATABASE_URL', '');

        expect(() => getWebDatabaseClient()).toThrow('DATABASE_URL is required');
    });
});
