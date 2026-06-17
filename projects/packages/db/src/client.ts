import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema.js';

export type DatabaseClient = {
    db: NodePgDatabase<typeof schema>;
    pool: Pool;
    close: () => Promise<void>;
};

export function createDatabaseClient(
    databaseUrl: string,
    poolConfig: Omit<PoolConfig, 'connectionString'> = {}
): DatabaseClient {
    const pool = new Pool({
        ...poolConfig,
        connectionString: databaseUrl,
    });
    const db = drizzle(pool, { schema });

    return {
        db,
        pool,
        async close() {
            await pool.end();
        },
    };
}
