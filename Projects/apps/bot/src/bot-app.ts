import type { AppConfig } from '@neonflux/config';
import { resolveEffectiveGuildDefcon } from '@neonflux/core/defcon';
import type { AppLogger } from '@neonflux/core/logging';
import { runDatabaseMigrations, type DatabaseClient } from '@neonflux/db';
import {
    createFluxerBot,
    type FluxerBot,
    type FluxerBotMessageEvent,
    type FluxerBotMessageUpdatedEvent,
} from '@neonflux/fluxer';

import {
    routeBotFeatureEvent,
    type BotFeatureEvent,
    type BotFeatureHandlerContext,
    type BotFeatureRouteError,
    type BotFeatureRouteResult,
} from './bot-feature-router.js';
import { reconcileBotInstallations } from './bot-installation-sync.js';
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
            const customStatusText = resolveBotCustomStatusText(config);

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
            const routeAndLogFeatureEvent = async (featureEvent: BotFeatureEvent): Promise<void> => {
                const result = await routeBotFeatureEvent(createFeatureHandlerContext(), featureEvent);

                if (result.isErr()) {
                    logFeatureRouteFailure(logger, result.error, featureEvent);
                    return;
                }

                logFeatureRouteResult(config, logger, result.value, featureEvent);
            };

            bot = createFluxerBot(
                {
                    instanceMode: deploymentMode.instanceMode,
                    ...(customStatusText ? { customStatusText } : {}),
                    ...(config.fluxerBotToken ? { fluxerBotToken: config.fluxerBotToken } : {}),
                },
                logger,
                {
                    async guildCreated(event) {
                        await routeAndLogFeatureEvent({
                            type: 'guild.lifecycle.created',
                            guildId: event.guildId,
                        });
                    },
                    async guildsReady(event) {
                        const result = await reconcileBotInstallations(database.db, deploymentMode, {
                            guildIds: event.guildIds,
                        });

                        if (result.isErr()) {
                            logger.error('bot.installation_reconcile_failed', {
                                error: result.error,
                            });
                            return;
                        }

                        if (config.appEnv === 'development') {
                            logger.info('bot.installation_reconciled', {
                                recordedGuildCount: result.value.recordedGuildIds.length,
                                removedGuildCount: result.value.removedGuildIds.length,
                            });
                        }
                    },
                    async guildDeleted(event) {
                        await routeAndLogFeatureEvent({
                            type: 'guild.lifecycle.deleted',
                            guildId: event.guildId,
                        });
                    },
                    async guildUpdated(event) {
                        await routeAndLogFeatureEvent({
                            type: 'guild.lifecycle.updated',
                            guildId: event.guildId,
                        });
                    },
                    async messageCreated(event) {
                        await routeAndLogFeatureEvent({
                            type: 'message.created',
                            ...toMessageFeatureFields(event),
                        });
                    },
                    async messageUpdated(event) {
                        await routeAndLogFeatureEvent({
                            type: 'message.updated',
                            ...toMessageFeatureFields(event),
                            oldContent: event.oldContent,
                        });
                    },
                    async messageDeleted(event) {
                        await routeAndLogFeatureEvent({
                            type: 'message.deleted',
                            messageId: event.messageId,
                            channelId: event.channelId,
                            guildId: event.guildId,
                            authorId: event.authorId,
                            content: event.content,
                        });
                    },
                    async reactionAdded(event) {
                        await routeAndLogFeatureEvent({
                            type: 'reaction.added',
                            messageId: event.messageId,
                            channelId: event.channelId,
                            guildId: event.guildId,
                            userId: event.userId,
                            emojiKey: event.emojiKey,
                        });
                    },
                    async reactionRemoved(event) {
                        await routeAndLogFeatureEvent({
                            type: 'reaction.removed',
                            messageId: event.messageId,
                            channelId: event.channelId,
                            guildId: event.guildId,
                            userId: event.userId,
                            emojiKey: event.emojiKey,
                        });
                    },
                    async memberJoined(event) {
                        await routeAndLogFeatureEvent({
                            type: 'member.joined',
                            guildId: event.guildId,
                            userId: event.userId,
                            roleIds: event.roleIds,
                        });
                    },
                    async memberUpdated(event) {
                        await routeAndLogFeatureEvent({
                            type: 'member.updated',
                            guildId: event.guildId,
                            userId: event.userId,
                            roleIds: event.roleIds,
                        });
                    },
                    async memberLeft(event) {
                        await routeAndLogFeatureEvent({
                            type: 'member.left',
                            guildId: event.guildId,
                            userId: event.userId,
                            roleIds: event.roleIds,
                        });
                    },
                    async banAdded(event) {
                        await routeAndLogFeatureEvent({
                            type: 'ban.added',
                            guildId: event.guildId,
                            userId: event.userId,
                        });
                    },
                    async banRemoved(event) {
                        await routeAndLogFeatureEvent({
                            type: 'ban.removed',
                            guildId: event.guildId,
                            userId: event.userId,
                        });
                    },
                    async roleCreated(event) {
                        await routeAndLogFeatureEvent({
                            type: 'role.created',
                            guildId: event.guildId,
                            roleId: event.roleId,
                        });
                    },
                    async roleUpdated(event) {
                        await routeAndLogFeatureEvent({
                            type: 'role.updated',
                            guildId: event.guildId,
                            roleId: event.roleId,
                        });
                    },
                    async roleDeleted(event) {
                        await routeAndLogFeatureEvent({
                            type: 'role.deleted',
                            guildId: event.guildId,
                            roleId: event.roleId,
                        });
                    },
                    async channelCreated(event) {
                        await routeAndLogFeatureEvent({
                            type: 'channel.created',
                            guildId: event.guildId,
                            channelId: event.channelId,
                            channelType: event.channelType,
                        });
                    },
                    async channelUpdated(event) {
                        await routeAndLogFeatureEvent({
                            type: 'channel.updated',
                            guildId: event.guildId,
                            channelId: event.channelId,
                            channelType: event.channelType,
                        });
                    },
                    async channelDeleted(event) {
                        await routeAndLogFeatureEvent({
                            type: 'channel.deleted',
                            guildId: event.guildId,
                            channelId: event.channelId,
                            channelType: event.channelType,
                        });
                    },
                    async voiceStateUpdated(event) {
                        await routeAndLogFeatureEvent({
                            type: 'voice_state.updated',
                            guildId: event.guildId,
                            userId: event.userId,
                            channelId: event.channelId,
                        });
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

function toMessageFeatureFields(event: FluxerBotMessageEvent | FluxerBotMessageUpdatedEvent) {
    return {
        messageId: event.messageId,
        channelId: event.channelId,
        guildId: event.guildId,
        authorId: event.authorId,
        authorIsBot: event.authorIsBot,
        authorRoleIds: event.authorRoleIds,
        authorIsServerOwner: event.authorIsServerOwner,
        authorHasManageServer: event.authorHasManageServer,
        content: event.content,
        mentionedUserIds: event.mentionedUserIds,
    };
}

function resolveBotCustomStatusText(config: AppConfig): string | undefined {
    const effectiveDefconLevel = resolveEffectiveGuildDefcon({
        appEnv: config.appEnv,
        override: config.guildDefconOverride,
    });

    switch (effectiveDefconLevel) {
        case 1:
            return 'DEFCON 1: Owner only mode';
        case 2:
            return 'DEFCON 2: Public commands disabled';
        case 3:
            return config.fluxerBotCustomStatusText;
    }
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
        ...(result.status === 'handled' && result.action ? { action: result.action } : {}),
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
        case 'guild.lifecycle.updated':
        case 'message.updated':
        case 'message.deleted':
        case 'reaction.added':
        case 'reaction.removed':
        case 'member.joined':
        case 'member.updated':
        case 'member.left':
        case 'ban.added':
        case 'ban.removed':
        case 'role.created':
        case 'role.updated':
        case 'role.deleted':
        case 'channel.created':
        case 'channel.updated':
        case 'channel.deleted':
        case 'voice_state.updated':
            logger.error('bot.feature_route_failed', {
                eventType: event.type,
                error: errorValue,
                ...getFeatureEventLogContext(event),
            });
            return;
    }
}

function getFeatureEventLogContext(event: BotFeatureEvent): Record<string, unknown> {
    switch (event.type) {
        case 'guild.lifecycle.created':
        case 'guild.lifecycle.deleted':
        case 'guild.lifecycle.updated':
            return {
                guildId: event.guildId,
            };

        case 'message.created':
        case 'message.updated':
            return {
                messageId: event.messageId,
                channelId: event.channelId,
                guildId: event.guildId,
                authorId: event.authorId,
                authorIsBot: event.authorIsBot,
                authorRoleCount: event.authorRoleIds.length,
                authorIsServerOwner: event.authorIsServerOwner,
                authorHasManageServer: event.authorHasManageServer,
                mentionedUserCount: event.mentionedUserIds.length,
                contentLength: event.content.length,
                ...(event.type === 'message.updated' ? { oldContentLength: event.oldContent?.length ?? null } : {}),
            };

        case 'message.deleted':
            return {
                messageId: event.messageId,
                channelId: event.channelId,
                guildId: event.guildId,
                authorId: event.authorId,
                contentLength: event.content?.length ?? null,
            };

        case 'reaction.added':
        case 'reaction.removed':
            return {
                messageId: event.messageId,
                channelId: event.channelId,
                guildId: event.guildId,
                userId: event.userId,
                emojiKey: event.emojiKey,
            };

        case 'member.joined':
        case 'member.updated':
        case 'member.left':
            return {
                guildId: event.guildId,
                userId: event.userId,
                roleCount: event.roleIds.length,
            };

        case 'ban.added':
        case 'ban.removed':
            return {
                guildId: event.guildId,
                userId: event.userId,
            };

        case 'role.created':
        case 'role.updated':
        case 'role.deleted':
            return {
                guildId: event.guildId,
                roleId: event.roleId,
            };

        case 'channel.created':
        case 'channel.updated':
        case 'channel.deleted':
            return {
                guildId: event.guildId,
                channelId: event.channelId,
                channelType: event.channelType,
            };

        case 'voice_state.updated':
            return {
                guildId: event.guildId,
                userId: event.userId,
                channelId: event.channelId,
            };
    }
}
