import type { AppConfig } from '@neonflux/config';
import type { AppLogger } from '@neonflux/core/logging';
import { runDatabaseMigrations, type DatabaseClient } from '@neonflux/db';
import { createFluxerBot, type FluxerBot } from '@neonflux/fluxer';

import { recordBotInstallationEvent, removeBotInstallationEvent } from './bot-installation-sync.js';
import { bootstrapDeploymentConfig } from './deployment-config-bootstrap.js';

export type BotApp = {
    start(): Promise<boolean>;
    stop(): Promise<void>;
};

export type CreateBotAppInput = {
    config: AppConfig;
    logger: AppLogger;
    database: DatabaseClient;
};

export function createBotApp({ config, logger, database }: CreateBotAppInput): BotApp {
    let bot: FluxerBot | undefined;
    let databaseClosed = false;

    async function closeDatabaseOnce(): Promise<void> {
        if (databaseClosed) {
            return;
        }

        databaseClosed = true;
        await database.close();
    }

    return {
        async start() {
            const migration = await runDatabaseMigrations(database, {
                autoMigrate: config.autoMigrate,
            });

            logger.info('database.migration', { status: migration.status });

            const deploymentConfigResult = await bootstrapDeploymentConfig(database.db, config);

            if (deploymentConfigResult.isErr()) {
                throw new Error(`Deployment config bootstrap failed: ${deploymentConfigResult.error}`);
            }

            const deploymentMode = deploymentConfigResult.value;

            logger.info('deployment.config', { instanceMode: deploymentMode.instanceMode });

            bot = createFluxerBot(
                {
                    instanceMode: deploymentMode.instanceMode,
                    ...(config.fluxerBotToken ? { fluxerBotToken: config.fluxerBotToken } : {}),
                },
                logger,
                {
                    async guildCreated(event) {
                        const result = await recordBotInstallationEvent(database.db, deploymentMode, event);

                        if (result.isErr()) {
                            logger.error('bot.installation_record_failed', {
                                guildId: event.guildId,
                                error: result.error,
                            });
                        }
                    },
                    async guildDeleted(event) {
                        const result = await removeBotInstallationEvent(database.db, deploymentMode, event);

                        if (result.isErr()) {
                            logger.error('bot.installation_remove_failed', {
                                guildId: event.guildId,
                                error: result.error,
                            });
                        }
                    },
                }
            );

            const started = await bot.start();

            if (!started) {
                await closeDatabaseOnce();
            }

            return started;
        },
        async stop() {
            await bot?.stop();
            await closeDatabaseOnce();
        },
    };
}
