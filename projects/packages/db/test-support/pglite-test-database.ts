import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import * as schema from '../src/schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data');

export type PgliteTestDatabase = {
    db: ReturnType<typeof drizzle<typeof schema>>;
    reset: () => Promise<void>;
    close: () => Promise<void>;
};

export async function createPgliteTestDatabase(testName: string): Promise<PgliteTestDatabase> {
    const dataDir = join(testDataRoot, `pglite-${testName}-test`, randomUUID());

    await mkdir(dataDir, { recursive: true });

    const client = new PGlite(dataDir);
    const db = drizzle(client, { schema });

    await migrate(db, { migrationsFolder });
    const resetSql = await buildResetSql(client);

    return {
        db,
        async reset() {
            if (!resetSql) {
                return;
            }

            await client.query(resetSql);
        },
        async close() {
            await client.close();
            await rm(dataDir, { recursive: true, force: true });
        },
    };
}

async function buildResetSql(client: PGlite): Promise<string | undefined> {
    const tables = await listPublicTableNames(client);

    if (tables.length === 0) {
        return undefined;
    }

    const tableList = tables
        .map((tableName) => `${quoteIdentifier('public')}.${quoteIdentifier(tableName)}`)
        .join(', ');

    return `truncate table ${tableList} restart identity cascade;`;
}

async function listPublicTableNames(client: PGlite): Promise<string[]> {
    const result = await client.query<{ table_name: string }>(`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
          and table_name <> '__drizzle_migrations'
        order by table_name;
    `);

    return result.rows.map((row) => row.table_name);
}

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
}
