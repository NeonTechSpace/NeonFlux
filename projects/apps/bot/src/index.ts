import { loadConfig } from '@neonflux/config';
import { createLogger } from '@neonflux/core/logging';
import { createDatabaseClient, runDatabaseMigrations } from '@neonflux/db';
import { createFluxerBot } from '@neonflux/fluxer';

import { recordBotInstallationEvent, removeBotInstallationEvent } from './bot-installation-sync.js';

const config = loadConfig();
const logger = createLogger(config);
const database = createDatabaseClient(config.databaseUrl);
const bot = createFluxerBot(config, logger, {
    async guildCreated(event) {
        const result = await recordBotInstallationEvent(database.db, config, event);

        if (result.isErr()) {
            logger.error('bot.installation_record_failed', {
                guildId: event.guildId,
                error: result.error,
            });
        }
    },
    async guildDeleted(event) {
        const result = await removeBotInstallationEvent(database.db, config, event);

        if (result.isErr()) {
            logger.error('bot.installation_remove_failed', {
                guildId: event.guildId,
                error: result.error,
            });
        }
    },
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
    logger.info('process.shutdown', { signal });
    await bot.stop();
    await database.close();
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
    const migration = await runDatabaseMigrations(database, {
        autoMigrate: config.autoMigrate,
    });

    logger.info('database.migration', { status: migration.status });

    const started = await bot.start();

    if (!started) {
        await database.close();
    }
}

try {
    await start();
} catch (error) {
    logger.error('process.startup_failed', { error: getErrorMessage(error) });
    await database.close();
    process.exit(1);
}
