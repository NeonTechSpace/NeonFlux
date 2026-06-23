import type { AppConfig } from '@neonflux/config';
import type { AppLogger } from '@neonflux/core/logging';
import { runDatabaseMigrations, type DatabaseClient } from '@neonflux/db';
import { createFluxerBot, type FluxerBot } from '@neonflux/fluxer';

import {
    routeBotFeatureEvent,
    type BotFeatureEvent,
    type BotFeatureHandlerContext,
    type BotFeatureRouteError,
    type BotFeatureRouteResult,
} from './bot-feature-router.js';
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

            const createFeatureHandlerContext = (): BotFeatureHandlerContext => {
                if (!bot) {
                    throw new Error('Fluxer bot is not initialized');
                }

                const botUserId = bot.client.user?.id;

                return {
                    db: database.db,
                    mode: deploymentMode,
                    appEnv: config.appEnv,
                    guildDefconOverride: config.guildDefconOverride,
                    client: bot.client,
                    ...(botUserId ? { botUserId } : {}),
                };
            };

            bot = createFluxerBot(
                {
                    instanceMode: deploymentMode.instanceMode,
                    ...(config.fluxerBotToken ? { fluxerBotToken: config.fluxerBotToken } : {}),
                },
                logger,
                {
                    async guildCreated(event) {
                        const featureEvent = {
                            type: 'guild.lifecycle.created',
                            guildId: event.guildId,
                        } satisfies BotFeatureEvent;
                        const result = await routeBotFeatureEvent(createFeatureHandlerContext(), featureEvent);

                        if (result.isErr()) {
                            logFeatureRouteFailure(logger, result.error, featureEvent);
                            return;
                        }

                        logFeatureRouteResult(config, logger, result.value, featureEvent);
                    },
                    async guildDeleted(event) {
                        const featureEvent = {
                            type: 'guild.lifecycle.deleted',
                            guildId: event.guildId,
                        } satisfies BotFeatureEvent;
                        const result = await routeBotFeatureEvent(createFeatureHandlerContext(), featureEvent);

                        if (result.isErr()) {
                            logFeatureRouteFailure(logger, result.error, featureEvent);
                            return;
                        }

                        logFeatureRouteResult(config, logger, result.value, featureEvent);
                    },
                    async messageCreated(event) {
                        const featureEvent = {
                            type: 'message.created',
                            messageId: event.messageId,
                            channelId: event.channelId,
                            guildId: event.guildId,
                            authorId: event.authorId,
                            authorIsBot: event.authorIsBot,
                            content: event.content,
                            mentionedUserIds: event.mentionedUserIds,
                        } satisfies BotFeatureEvent;
                        const result = await routeBotFeatureEvent(createFeatureHandlerContext(), featureEvent);

                        if (result.isErr()) {
                            logFeatureRouteFailure(logger, result.error, featureEvent);
                            return;
                        }

                        logFeatureRouteResult(config, logger, result.value, featureEvent);
                    },
                }
            );

            const started = await bot.start();

            if (!started) {
                await closeDatabaseOnce();
                return false;
            }

            return true;
        },
        async stop() {
            await bot?.stop();
            await closeDatabaseOnce();
        },
    };
}

function logFeatureRouteResult(
    config: AppConfig,
    logger: AppLogger,
    result: BotFeatureRouteResult,
    event: BotFeatureEvent
): void {
    if (config.appEnv !== 'development') {
        return;
    }

    logger.info('bot.feature_route', {
        eventType: result.eventType,
        status: result.status,
        ...(result.status === 'ignored' && result.reason ? { reason: result.reason } : {}),
        guildDefconOverride: config.guildDefconOverride,
        ...getFeatureEventLogContext(event),
    });
}

function logFeatureRouteFailure(logger: AppLogger, errorValue: BotFeatureRouteError, event: BotFeatureEvent): void {
    switch (event.type) {
        case 'guild.lifecycle.created':
            logger.error('bot.installation_record_failed', {
                guildId: event.guildId,
                error: errorValue,
            });
            return;
        case 'guild.lifecycle.deleted':
            logger.error('bot.installation_remove_failed', {
                guildId: event.guildId,
                error: errorValue,
            });
            return;
        case 'message.created':
            logger.error('bot.message_created_route_failed', {
                messageId: event.messageId,
                channelId: event.channelId,
                guildId: event.guildId,
                error: errorValue,
            });
            return;
    }
}

function getFeatureEventLogContext(event: BotFeatureEvent): Record<string, unknown> {
    switch (event.type) {
        case 'guild.lifecycle.created':
        case 'guild.lifecycle.deleted':
            return {
                guildId: event.guildId,
            };

        case 'message.created':
            return {
                messageId: event.messageId,
                channelId: event.channelId,
                guildId: event.guildId,
                authorId: event.authorId,
                authorIsBot: event.authorIsBot,
                mentionedUserCount: event.mentionedUserIds.length,
                contentLength: event.content.length,
            };
    }
}
