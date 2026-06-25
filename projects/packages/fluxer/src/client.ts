import { Client, Events, GatewayOpcodes, PermissionFlags, type Message } from '@fluxerjs/core';

import type { InstanceMode } from '@neonflux/config';
import type { AppLogger } from '@neonflux/core/logging';

export type FluxerBot = ReturnType<typeof createFluxerBot>;

export type FluxerBotConfig = {
    customStatusText?: string;
    fluxerBotToken?: string;
    instanceMode: InstanceMode;
};

export type FluxerBotGuildEvent = {
    guildId: string;
};

export type FluxerBotGuildsReadyEvent = {
    guildIds: string[];
};

export type FluxerBotMessageEvent = {
    messageId: string;
    channelId: string;
    guildId: string | null;
    authorId: string;
    authorIsBot: boolean;
    authorRoleIds: string[];
    authorIsServerOwner: boolean;
    authorHasManageServer: boolean;
    content: string;
    mentionedUserIds: string[];
};

export type FluxerBotLifecycleHandlers = {
    guildCreated?: (event: FluxerBotGuildEvent) => void | Promise<void>;
    guildDeleted?: (event: FluxerBotGuildEvent) => void | Promise<void>;
    guildsReady?: (event: FluxerBotGuildsReadyEvent) => void | Promise<void>;
    messageCreated?: (event: FluxerBotMessageEvent) => void | Promise<void>;
};

type FluxerBotGuildEventHandler = (event: FluxerBotGuildEvent) => void | Promise<void>;
type FluxerBotGuildsReadyEventHandler = (event: FluxerBotGuildsReadyEvent) => void | Promise<void>;
type FluxerBotMessageEventHandler = (event: FluxerBotMessageEvent) => void | Promise<void>;

const BOT_PRESENCE_STATUS = 'online';

function createBotPresence(customStatusText: string) {
    return {
        status: BOT_PRESENCE_STATUS,
        custom_status: {
            text: customStatusText,
        },
    } as const;
}

export function createFluxerBot(
    config: FluxerBotConfig,
    logger: AppLogger,
    lifecycleHandlers: FluxerBotLifecycleHandlers = {}
) {
    const client = new Client({ waitForGuilds: true });
    const configuredCustomStatusText = normalizeConfiguredCustomStatusText(config.customStatusText);

    client.once(Events.Ready, () => {
        logger.info('fluxer.ready', {
            instanceMode: config.instanceMode,
        });
        if (configuredCustomStatusText) {
            applyBotPresence(logger, client, configuredCustomStatusText);
        }
        void runCurrentGuildSync(logger, lifecycleHandlers.guildsReady, client);
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

function applyBotPresence(logger: AppLogger, client: Client, customStatusText: string): void {
    const presence = createBotPresence(customStatusText);

    try {
        client.sendToGateway(0, {
            op: GatewayOpcodes.PresenceUpdate,
            d: presence,
        });
        logger.info('fluxer.presence_updated', {
            presenceStatus: presence.status,
            customStatusText: presence.custom_status.text,
        });
    } catch {
        logger.error('fluxer.presence_update_failed', {
            presenceStatus: presence.status,
            customStatusText: presence.custom_status.text,
        });
    }
}

function normalizeConfiguredCustomStatusText(customStatusText: string | undefined): string | undefined {
    const normalizedCustomStatusText = customStatusText?.trim();

    return normalizedCustomStatusText && normalizedCustomStatusText.length > 0 ? normalizedCustomStatusText : undefined;
}

async function runCurrentGuildSync(
    logger: AppLogger,
    handler: FluxerBotGuildsReadyEventHandler | undefined,
    client: Client
): Promise<void> {
    if (!handler) {
        return;
    }

    try {
        const guilds = await client.user?.fetchGuilds();

        if (!guilds) {
            logger.error('fluxer.guilds_ready_fetch_failed', {
                reason: 'bot-user-unavailable',
            });
            return;
        }

        await handler({
            guildIds: guilds.map((guild) => guild.id),
        });
    } catch {
        logger.error('fluxer.guilds_ready_fetch_failed');
    }
}

function normalizeMessageEvent(message: Message): FluxerBotMessageEvent {
    const guild = message.guild;
    const authorMember = guild?.members.get(message.author.id);

    return {
        messageId: message.id,
        channelId: message.channelId,
        guildId: message.guildId,
        authorId: message.author.id,
        authorIsBot: message.author.bot,
        authorRoleIds: [...(authorMember?.roles.roleIds ?? [])],
        authorIsServerOwner: guild?.ownerId === message.author.id,
        authorHasManageServer: authorMember?.permissions.has(PermissionFlags.ManageGuild) ?? false,
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
