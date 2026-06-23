import { Client, Events, type Message } from '@fluxerjs/core';

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

export type FluxerBotMessageEvent = {
    messageId: string;
    channelId: string;
    guildId: string | null;
    authorId: string;
    authorIsBot: boolean;
    content: string;
    mentionedUserIds: string[];
};

export type FluxerBotLifecycleHandlers = {
    guildCreated?: (event: FluxerBotGuildEvent) => void | Promise<void>;
    guildDeleted?: (event: FluxerBotGuildEvent) => void | Promise<void>;
    messageCreated?: (event: FluxerBotMessageEvent) => void | Promise<void>;
};

type FluxerBotGuildEventHandler = (event: FluxerBotGuildEvent) => void | Promise<void>;
type FluxerBotMessageEventHandler = (event: FluxerBotMessageEvent) => void | Promise<void>;

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

    client.on(Events.MessageCreate, (message) => {
        void runMessageLifecycleHandler(
            logger,
            'fluxer.message_created_handler_failed',
            lifecycleHandlers.messageCreated,
            normalizeMessageEvent(message)
        );
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

function normalizeMessageEvent(message: Message): FluxerBotMessageEvent {
    return {
        messageId: message.id,
        channelId: message.channelId,
        guildId: message.guildId,
        authorId: message.author.id,
        authorIsBot: message.author.bot,
        content: message.content,
        mentionedUserIds: message.mentions.map((user) => user.id),
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

async function runMessageLifecycleHandler(
    logger: AppLogger,
    logEvent: string,
    handler: FluxerBotMessageEventHandler | undefined,
    event: FluxerBotMessageEvent
): Promise<void> {
    if (!handler) {
        return;
    }

    try {
        await handler(event);
    } catch {
        logger.error(logEvent, {
            messageId: event.messageId,
            channelId: event.channelId,
            guildId: event.guildId,
        });
    }
}
