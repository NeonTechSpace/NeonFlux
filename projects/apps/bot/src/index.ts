import { loadBotConfig } from '@neonflux/config';
import { createLogger } from '@neonflux/core/logging';
import { createDatabaseClient } from '@neonflux/db';

import { createBotApp } from './bot-app.js';

const config = loadBotConfig();
const logger = createLogger(config);
const database = createDatabaseClient(config.databaseUrl);
const app = createBotApp({ config, logger, database });

async function shutdown(signal: NodeJS.Signals): Promise<void> {
    logger.info('process.shutdown', { signal });
    await app.stop();
    process.exit(0);
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

process.once('SIGINT', () => {
    void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
});

async function start(): Promise<void> {
    await app.start();
}

try {
    await start();
} catch (error) {
    logger.error('process.startup_failed', { error: getErrorMessage(error) });
    await app.stop();
    process.exit(1);
}
