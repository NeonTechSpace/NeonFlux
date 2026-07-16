import type { AppConfig, AppMode } from '@neonflux/config';
import { resolveEffectiveGuildDefcon } from '@neonflux/core/defcon';
import type { AppLogger } from '@neonflux/core/logging';
import type { RuntimeDbClient } from '@neonflux/db';
import {
    createFluxerBot,
    type FluxerBot,
    type FluxerBotMessageEvent,
    type FluxerBotMessageUpdatedEvent,
} from '@neonflux/fluxer';

import {
    routeBotFeatureEvent,
    type BotFeatureEvent,
    type BotFeatureRoutingContext,
    type BotFeatureRouteError,
    type BotFeatureRouteResult,
} from './bot-feature-router.js';
import { createBotGrowthTelemetryIngestor } from './bot-growth-telemetry-ingestor.js';
import { trackGrowthOverviewEvent } from './bot-growth-tracking.js';
import { startBotInternalApiServer, type BotInternalApiServer } from './bot-internal-api-server.js';
import { reconcileBotInstallationsWithRetry } from './bot-installation-sync.js';
import { startDashboardPostingScheduler } from './bot-posting-scheduler.js';
import { startStructureBackupScheduler } from './bot-structure-backups.js';
import { startBlueprintRunWorker } from './bot-blueprint-run-worker.js';
import { bootstrapDeploymentConfig } from './deployment-config-bootstrap.js';

export type BotApp = {
    start(): Promise<boolean>;
    stop(): Promise<void>;
};

export type CreateBotAppInput = {
    config: AppConfig;
    logger: AppLogger;
    database: RuntimeDbClient;
};

const INSTALLATION_REPAIR_INTERVAL_MS = 5 * 60 * 1000;

export function createBotApp({ config, logger, database }: CreateBotAppInput): BotApp {
    let bot: FluxerBot | undefined;
    let botInternalApiServer: BotInternalApiServer | undefined;
    let databaseClosed = false;
    let installationRepairScheduler: { stop(): Promise<void> } | undefined;
    let postingScheduler: { stop(): Promise<void>; wake(): void } | undefined;
    let structureBackupScheduler: { stop(): Promise<void> } | undefined;
    let blueprintRunWorker: { stop(): Promise<void> } | undefined;
    let growthTelemetry: ReturnType<typeof createBotGrowthTelemetryIngestor> | undefined;

    async function closeDatabaseOnce(): Promise<void> {
        if (databaseClosed) {
            return;
        }

        databaseClosed = true;
        await database.close();
    }

    return {
        async start() {
            logger.info('database.runtime', { store: 'convex' });

            const deploymentConfigResult = await bootstrapDeploymentConfig(database.db, config);

            if (deploymentConfigResult.isErr()) {
                throw new Error(`Deployment config bootstrap failed: ${deploymentConfigResult.error}`);
            }

            const deploymentMode = deploymentConfigResult.value;

            logger.info('deployment.config', { instanceMode: deploymentMode.instanceMode });
            const customStatusText = resolveBotCustomStatusText(config);
            const botInternalApiAuth = config.fluxerBotToken ? requireBotInternalApiAuthConfig(config) : undefined;

            const createFeatureHandlerContext = (): BotFeatureRoutingContext => {
                if (!bot) {
                    throw new Error('Fluxer bot is not initialized');
                }
                if (!growthTelemetry) {
                    throw new Error('Growth telemetry is not initialized');
                }

                const botUserId = bot.client.user?.id;

                return {
                    db: database.db,
                    mode: deploymentMode,
                    appEnv: config.appEnv,
                    guildDefconOverride: config.guildDefconOverride,
                    client: bot.client,
                    logger,
                    growthTelemetry,
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

            growthTelemetry = createBotGrowthTelemetryIngestor({
                logger,
                process: (event, signal) => trackGrowthOverviewEvent(createFeatureHandlerContext(), event, { signal }),
            });

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
                    async guildAvailable(event) {
                        await routeAndLogFeatureEvent({
                            type: 'guild.lifecycle.available',
                            guildId: event.guildId,
                        });
                    },
                    async guildUnavailable(event) {
                        await routeAndLogFeatureEvent({
                            type: 'guild.lifecycle.unavailable',
                            guildId: event.guildId,
                        });
                    },
                    async guildsReady(event) {
                        const result = await reconcileBotInstallationsWithRetry(database.db, deploymentMode, {
                            guildIds: event.guildIds,
                        });

                        if (result.isErr()) {
                            logger.error('bot.installation_reconcile_failed', {
                                error: result.error,
                            });
                            throw new Error(`Bot installation reconciliation failed: ${result.error}`);
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
                    async memberJoined(event) {
                        await routeAndLogFeatureEvent({
                            type: 'member.joined',
                            guildId: event.guildId,
                            userId: event.userId,
                            roleIds: event.roleIds,
                            joinedAt: event.joinedAt,
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
                            oldChannelId: event.oldChannelId,
                            oldChannelOccupancy: event.oldChannelOccupancy,
                        });
                    },
                }
            );
            const started = await bot.start();

            if (!started) {
                await closeDatabaseOnce();
                return false;
            }

            if (config.fluxerBotToken && botInternalApiAuth) {
                postingScheduler = startDashboardPostingScheduler({
                    context: createFeatureHandlerContext(),
                    logger,
                });
                try {
                    botInternalApiServer = await startBotInternalApiServer({
                        bot,
                        host: config.botInternalApiHost,
                        logger,
                        port: config.botInternalApiPort,
                        wakePostingWorker: () => postingScheduler?.wake(),
                        webAuthJwtIssuer: botInternalApiAuth.issuer,
                        webAuthJwtJwks: botInternalApiAuth.jwks,
                    });
                } catch (error) {
                    await postingScheduler.stop();
                    postingScheduler = undefined;
                    throw error;
                }
                installationRepairScheduler = startInstallationRepairScheduler({
                    bot,
                    database,
                    logger,
                    mode: deploymentMode,
                });
                structureBackupScheduler = startStructureBackupScheduler({
                    client: bot.client,
                    database,
                    logger,
                });
                blueprintRunWorker = startBlueprintRunWorker({
                    botToken: config.fluxerBotToken,
                    database,
                    logger,
                });
            }

            return true;
        },
        async stop() {
            bot?.stopIntake();
            await botInternalApiServer?.stop();
            await installationRepairScheduler?.stop();
            await postingScheduler?.stop();
            await structureBackupScheduler?.stop();
            await blueprintRunWorker?.stop();
            await growthTelemetry?.stop();
            await bot?.stop();
            await closeDatabaseOnce();
        },
    };
}

function requireBotInternalApiAuthConfig(config: AppConfig): { issuer: string; jwks: string } {
    const issuer = config.convex?.webAuthJwtIssuer;
    const jwks = config.convex?.webAuthJwtJwks;

    if (!issuer) throw new Error('NEONFLUX_WEB_AUTH_JWT_ISSUER is required for the bot internal API server.');
    if (!jwks) throw new Error('NEONFLUX_WEB_AUTH_JWT_JWKS is required for the bot internal API server.');

    return { issuer, jwks };
}

function startInstallationRepairScheduler(input: {
    bot: FluxerBot;
    database: RuntimeDbClient;
    logger: AppLogger;
    mode: AppMode;
}): { stop(): Promise<void> } {
    let running: Promise<void> | undefined;
    const repair = () => {
        if (running) return;

        running = (async () => {
            const result = await reconcileBotInstallationsWithRetry(input.database.db, input.mode, {
                guildIds: [...input.bot.client.guilds.keys()],
            });

            if (result.isErr()) {
                input.logger.error('bot.installation_periodic_reconcile_failed', { error: result.error });
            }
        })().finally(() => {
            running = undefined;
        });
    };
    const interval = setInterval(repair, INSTALLATION_REPAIR_INTERVAL_MS);

    return {
        async stop() {
            clearInterval(interval);
            await running;
        },
    };
}

function toMessageFeatureFields(event: FluxerBotMessageEvent | FluxerBotMessageUpdatedEvent) {
    return {
        messageId: event.messageId,
        createdAt: event.createdAt,
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
            return 'DEFCON 2: Guarded commands restricted';
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
        case 'guild.lifecycle.available':
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
        case 'guild.lifecycle.unavailable':
        case 'message.updated':
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
        case 'guild.lifecycle.available':
        case 'guild.lifecycle.unavailable':
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
                oldChannelId: event.oldChannelId,
                oldChannelOccupancy: event.oldChannelOccupancy,
            };
    }
}
