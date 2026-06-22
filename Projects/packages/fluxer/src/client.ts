import { Client, Events } from '@fluxerjs/core';

import type { InstanceMode } from '@neonflux/config';
import type { AppLogger } from '@neonflux/core/logging';

export type FluxerBot = ReturnType<typeof createFluxerBot>;

export type FluxerBotConfig = {
    fluxerBotToken?: string;
    instanceMode: InstanceMode;
};

export type FluxerBotGuildEvent = {
    guildId: string;
};

export type FluxerBotLifecycleHandlers = {
    guildCreated?: (event: FluxerBotGuildEvent) => void | Promise<void>;
    guildDeleted?: (event: FluxerBotGuildEvent) => void | Promise<void>;
};

type FluxerBotGuildEventHandler = (event: FluxerBotGuildEvent) => void | Promise<void>;

export function createFluxerBot(
    config: FluxerBotConfig,
    logger: AppLogger,
    lifecycleHandlers: FluxerBotLifecycleHandlers = {}
) {
    const client = new Client();

    client.once(Events.Ready, () => {
        logger.info('fluxer.ready', {
            instanceMode: config.instanceMode,
        });
    });

    client.on(Events.GuildCreate, (guild) => {
        void runGuildLifecycleHandler(logger, 'fluxer.guild_created_handler_failed', lifecycleHandlers.guildCreated, {
            guildId: guild.id,
        });
    });

    client.on(Events.GuildDelete, (guild) => {
        void runGuildLifecycleHandler(logger, 'fluxer.guild_deleted_handler_failed', lifecycleHandlers.guildDeleted, {
            guildId: guild.id,
        });
    });

    return {
        client,
        async start(): Promise<boolean> {
            if (!config.fluxerBotToken) {
                logger.warn('fluxer.token_missing');
                return false;
            }

            await client.login(config.fluxerBotToken);
            return true;
        },
        async stop(): Promise<void> {
            await client.destroy();
        },
    };
}

async function runGuildLifecycleHandler(
    logger: AppLogger,
    logEvent: string,
    handler: FluxerBotGuildEventHandler | undefined,
    event: FluxerBotGuildEvent
): Promise<void> {
    if (!handler) {
        return;
    }

    try {
        await handler(event);
    } catch {
        logger.error(logEvent, {
            guildId: event.guildId,
        });
    }
}
