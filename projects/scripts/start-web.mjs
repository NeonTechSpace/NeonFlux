import { createDatabaseClient, runDatabaseMigrations } from '@neonflux/db';
import { loadWebConfig } from '@neonflux/config';

const webServerUrl = new URL('../apps/web/.output/server/index.mjs', import.meta.url);

function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

const config = loadWebConfig();
const database = createDatabaseClient(config.databaseUrl);

try {
    const migration = await runDatabaseMigrations(database, {
        autoMigrate: config.autoMigrate,
    });

    console.info(`database.migration status=${migration.status}`);
} catch (error) {
    console.error(`web.startup_failed error=${getErrorMessage(error)}`);
    process.exit(1);
} finally {
    await database.close();
}

await import(webServerUrl.href);
