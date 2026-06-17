import { describe, expect, it } from 'vitest';

import { createDatabaseClient } from './client.js';

describe('createDatabaseClient', () => {
    it('creates a Postgres client without opening a connection eagerly', async () => {
        const client = createDatabaseClient('postgres://postgres:postgres@localhost:5432/neonflux_dev');

        expect(client.db).toBeDefined();
        expect(client.pool).toBeDefined();

        await client.close();
    });
});
