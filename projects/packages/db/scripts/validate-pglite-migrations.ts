import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import * as schema from '../src/schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const dataDir = join(projectRoot, 'data', 'pglite-migration-check');
const expectedTables = [
    'bot_events',
    'bot_installations',
    'deployment_config',
    'fluxer_oauth_tokens',
    'guild_feature_settings',
    'web_sessions',
];

await rm(dataDir, { recursive: true, force: true });
await mkdir(dataDir, { recursive: true });

const client = new PGlite(dataDir);
const db = drizzle(client, { schema });

try {
    await migrate(db, { migrationsFolder });

    const tables = await client.query<{ table_name: string }>(`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
        order by table_name;
    `);
    const tableNames = new Set(tables.rows.map((table) => table.table_name));

    for (const tableName of expectedTables) {
        if (!tableNames.has(tableName)) {
            throw new Error(`Missing migrated table: ${tableName}`);
        }
    }

    console.warn('PGlite migration validation passed');
} finally {
    await client.close();
}
