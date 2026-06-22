import { Client } from 'pg';

import { loadConfig } from '../packages/config/src/env.js';

const config = loadConfig();
const explicitDatabaseUrl = process.env.DATABASE_URL?.trim();

if (config.appEnv === 'production' || config.nodeEnv === 'production') {
    throw new Error('Refusing to reset persistence when APP_ENV or NODE_ENV is production.');
}

if (!explicitDatabaseUrl) {
    throw new Error('DATABASE_URL is required for dev reset. Refusing to use a fallback database URL.');
}

const client = new Client({ connectionString: config.databaseUrl });

try {
    process.stdout.write('Resetting configured development database...\n');

    await client.connect();
    await client.query(`
        drop schema if exists drizzle cascade;
        drop schema if exists public cascade;
        create schema public;
        grant all on schema public to public;
    `);

    process.stdout.write('Development database reset complete.\n');
} catch {
    process.stderr.write('Development database reset failed. Check DATABASE_URL, database status, and permissions.\n');
    process.exitCode = 1;
} finally {
    await client.end().catch(() => undefined);
}
