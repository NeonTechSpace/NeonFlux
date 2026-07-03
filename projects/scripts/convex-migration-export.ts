import { Client } from 'pg';

import { exportPostgresMigrationBundle } from '../packages/convex/src/migration/index.js';
import { loadLocalEnv } from '../packages/config/src/env.js';
import {
    readDrizzleMigrationHead,
    readRequiredEnv,
    readRequiredArg,
    readWorkspaceRevision,
    writeJson,
} from './convex-migration-support.js';

loadLocalEnv();

const outPath = readRequiredArg('--out');
const client = new Client({ connectionString: readRequiredEnv('DATABASE_URL') });

try {
    await client.connect();

    const bundle = await exportPostgresMigrationBundle(client, {
        migrationHead: await readDrizzleMigrationHead(),
        revision: await readWorkspaceRevision(),
        sourceDatabaseId: await readSourceDatabaseId(client),
    });

    await writeJson(outPath, bundle);
    process.stdout.write(`Wrote Postgres migration export to ${outPath}\n`);
} finally {
    await client.end().catch(() => undefined);
}

async function readSourceDatabaseId(client: Client): Promise<string> {
    const result = await client.query<{ current_database: string; server_version_num: string }>(`
        select current_database(), current_setting('server_version_num') as server_version_num;
    `);
    const row = result.rows[0];

    return row ? `${row.current_database}@postgres-${row.server_version_num}` : 'unknown-postgres-source';
}
