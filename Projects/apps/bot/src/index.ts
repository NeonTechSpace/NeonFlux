import { loadConfig } from '@neonflux/config';
import { createLogger } from '@neonflux/core/logging';
import { createDatabaseClient } from '@neonflux/db';
import { createFluxerBot } from '@neonflux/fluxer';

const config = loadConfig();
const logger = createLogger(config);
const database = createDatabaseClient(config.databaseUrl);
const bot = createFluxerBot(config, logger);

async function shutdown(signal: NodeJS.Signals): Promise<void> {
    logger.info('process.shutdown', { signal });
    await bot.stop();
    await database.close();
    process.exit(0);
}

process.once('SIGINT', () => {
    void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
});

const started = await bot.start();

if (!started) {
    await database.close();
}
