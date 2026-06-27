import {
    Client,
    Events,
    GatewayOpcodes,
    PermissionFlags,
    type Channel,
    type GuildBan,
    type GuildMember,
    type Message,
    type MessageReaction,
    type PartialMessage,
    type User,
} from '@fluxerjs/core';

import type { InstanceMode } from '@neonflux/config';
import type { AppLogger } from '@neonflux/core/logging';

import {
    normalizeVoiceStateEvent,
    syncVoiceStateCache,
    type FluxerBotVoiceStateEvent,
    type VoiceStateCache,
} from './voice-state-cache.js';

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

export type FluxerBotMessageUpdatedEvent = FluxerBotMessageEvent & {
    oldContent: string | null;
};

export type FluxerBotMessageDeletedEvent = {
    messageId: string;
    channelId: string;
    guildId: string | null;
    authorId: string | null;
    content: string | null;
};

export type FluxerBotReactionEvent = {
    messageId: string;
    channelId: string;
    guildId: string | null;
    userId: string;
    emojiKey: string;
};

export type FluxerBotMemberEvent = {
    guildId: string;
    userId: string;
    roleIds: string[];
};

export type FluxerBotBanEvent = {
    guildId: string;
    userId: string;
};

export type FluxerBotRoleEvent = {
    guildId: string;
    roleId: string;
};

export type FluxerBotChannelEvent = {
    guildId: string | null;
    channelId: string;
    channelType: number;
};

export type { FluxerBotVoiceStateEvent } from './voice-state-cache.js';

export type FluxerBotLifecycleHandlers = {
    guildCreated?: (event: FluxerBotGuildEvent) => void | Promise<void>;
    guildDeleted?: (event: FluxerBotGuildEvent) => void | Promise<void>;
    guildUpdated?: (event: FluxerBotGuildEvent) => void | Promise<void>;
    guildsReady?: (event: FluxerBotGuildsReadyEvent) => void | Promise<void>;
    messageDeleted?: (event: FluxerBotMessageDeletedEvent) => void | Promise<void>;
    messageCreated?: (event: FluxerBotMessageEvent) => void | Promise<void>;
    messageUpdated?: (event: FluxerBotMessageUpdatedEvent) => void | Promise<void>;
    reactionAdded?: (event: FluxerBotReactionEvent) => void | Promise<void>;
    reactionRemoved?: (event: FluxerBotReactionEvent) => void | Promise<void>;
    memberJoined?: (event: FluxerBotMemberEvent) => void | Promise<void>;
    memberUpdated?: (event: FluxerBotMemberEvent) => void | Promise<void>;
    memberLeft?: (event: FluxerBotMemberEvent) => void | Promise<void>;
    banAdded?: (event: FluxerBotBanEvent) => void | Promise<void>;
    banRemoved?: (event: FluxerBotBanEvent) => void | Promise<void>;
    roleCreated?: (event: FluxerBotRoleEvent) => void | Promise<void>;
    roleUpdated?: (event: FluxerBotRoleEvent) => void | Promise<void>;
    roleDeleted?: (event: FluxerBotRoleEvent) => void | Promise<void>;
    channelCreated?: (event: FluxerBotChannelEvent) => void | Promise<void>;
    channelUpdated?: (event: FluxerBotChannelEvent) => void | Promise<void>;
    channelDeleted?: (event: FluxerBotChannelEvent) => void | Promise<void>;
    voiceStateUpdated?: (event: FluxerBotVoiceStateEvent) => void | Promise<void>;
};

type FluxerBotGuildsReadyEventHandler = (event: FluxerBotGuildsReadyEvent) => void | Promise<void>;
type FluxerBotEventHandler<TEvent> = (event: TEvent) => void | Promise<void>;

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
    const voiceStateCache: VoiceStateCache = new Map();

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
        voiceStateCache.delete(guild.id);
        void runLifecycleHandler(logger, 'fluxer.guild_created_handler_failed', lifecycleHandlers.guildCreated, {
            guildId: guild.id,
        });
    });

    client.on(Events.GuildDelete, (guild) => {
        voiceStateCache.delete(guild.id);
        void runLifecycleHandler(logger, 'fluxer.guild_deleted_handler_failed', lifecycleHandlers.guildDeleted, {
            guildId: guild.id,
        });
    });

    client.on(Events.GuildUpdate, (_oldGuild, newGuild) => {
        void runLifecycleHandler(logger, 'fluxer.guild_updated_handler_failed', lifecycleHandlers.guildUpdated, {
            guildId: newGuild.id,
        });
    });

    client.on(Events.MessageCreate, (message) => {
        void runLifecycleHandler(
            logger,
            'fluxer.message_created_handler_failed',
            lifecycleHandlers.messageCreated,
            normalizeMessageEvent(message),
            createMessageLogContext
        );
    });

    client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
        void runLifecycleHandler(
            logger,
            'fluxer.message_updated_handler_failed',
            lifecycleHandlers.messageUpdated,
            normalizeMessageUpdatedEvent(oldMessage, newMessage),
            createMessageLogContext
        );
    });

    client.on(Events.MessageDelete, (message) => {
        void runLifecycleHandler(
            logger,
            'fluxer.message_deleted_handler_failed',
            lifecycleHandlers.messageDeleted,
            normalizeMessageDeletedEvent(message),
            createDeletedMessageLogContext
        );
    });

    client.on(Events.MessageReactionAdd, (reaction, user, messageId, channelId, _emoji, userId) => {
        void runLifecycleHandler(
            logger,
            'fluxer.reaction_added_handler_failed',
            lifecycleHandlers.reactionAdded,
            normalizeReactionEvent(reaction, user, messageId, channelId, userId)
        );
    });

    client.on(Events.MessageReactionRemove, (reaction, user, messageId, channelId, _emoji, userId) => {
        void runLifecycleHandler(
            logger,
            'fluxer.reaction_removed_handler_failed',
            lifecycleHandlers.reactionRemoved,
            normalizeReactionEvent(reaction, user, messageId, channelId, userId)
        );
    });

    client.on(Events.GuildMemberAdd, (member) => {
        void runLifecycleHandler(
            logger,
            'fluxer.member_joined_handler_failed',
            lifecycleHandlers.memberJoined,
            normalizeMemberEvent(member)
        );
    });

    client.on(Events.GuildMemberUpdate, (_oldMember, newMember) => {
        void runLifecycleHandler(
            logger,
            'fluxer.member_updated_handler_failed',
            lifecycleHandlers.memberUpdated,
            normalizeMemberEvent(newMember)
        );
    });

    client.on(Events.GuildMemberRemove, (member) => {
        void runLifecycleHandler(
            logger,
            'fluxer.member_left_handler_failed',
            lifecycleHandlers.memberLeft,
            normalizeMemberEvent(member)
        );
    });

    client.on(Events.GuildBanAdd, (ban) => {
        void runLifecycleHandler(
            logger,
            'fluxer.ban_added_handler_failed',
            lifecycleHandlers.banAdded,
            normalizeBanEvent(ban)
        );
    });

    client.on(Events.GuildBanRemove, (ban) => {
        void runLifecycleHandler(
            logger,
            'fluxer.ban_removed_handler_failed',
            lifecycleHandlers.banRemoved,
            normalizeBanEvent(ban)
        );
    });

    client.on(Events.GuildRoleCreate, (event) => {
        void runLifecycleHandler(
            logger,
            'fluxer.role_created_handler_failed',
            lifecycleHandlers.roleCreated,
            normalizeRoleEvent(event)
        );
    });

    client.on(Events.GuildRoleUpdate, (event) => {
        void runLifecycleHandler(
            logger,
            'fluxer.role_updated_handler_failed',
            lifecycleHandlers.roleUpdated,
            normalizeRoleEvent(event)
        );
    });

    client.on(Events.GuildRoleDelete, (event) => {
        void runLifecycleHandler(
            logger,
            'fluxer.role_deleted_handler_failed',
            lifecycleHandlers.roleDeleted,
            normalizeRoleEvent(event)
        );
    });

    client.on(Events.ChannelCreate, (channel) => {
        void runLifecycleHandler(
            logger,
            'fluxer.channel_created_handler_failed',
            lifecycleHandlers.channelCreated,
            normalizeChannelEvent(channel)
        );
    });

    client.on(Events.ChannelUpdate, (_oldChannel, newChannel) => {
        void runLifecycleHandler(
            logger,
            'fluxer.channel_updated_handler_failed',
            lifecycleHandlers.channelUpdated,
            normalizeChannelEvent(newChannel)
        );
    });

    client.on(Events.ChannelDelete, (channel) => {
        void runLifecycleHandler(
            logger,
            'fluxer.channel_deleted_handler_failed',
            lifecycleHandlers.channelDeleted,
            normalizeChannelEvent(channel)
        );
    });

    client.on(Events.VoiceStatesSync, (event) => {
        syncVoiceStateCache(voiceStateCache, event);
    });

    client.on(Events.VoiceStateUpdate, (event) => {
        void runLifecycleHandler(
            logger,
            'fluxer.voice_state_updated_handler_failed',
            lifecycleHandlers.voiceStateUpdated,
            normalizeVoiceStateEvent(event, voiceStateCache)
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

function normalizeMessageUpdatedEvent(oldMessage: Message | null, newMessage: Message): FluxerBotMessageUpdatedEvent {
    return {
        ...normalizeMessageEvent(newMessage),
        oldContent: oldMessage?.content ?? null,
    };
}

function normalizeMessageDeletedEvent(message: PartialMessage): FluxerBotMessageDeletedEvent {
    return {
        messageId: message.id,
        channelId: message.channelId,
        guildId: null,
        authorId: message.authorId ?? null,
        content: message.content ?? null,
    };
}

function normalizeReactionEvent(
    reaction: MessageReaction,
    user: User,
    messageId: string,
    channelId: string,
    userId: string
): FluxerBotReactionEvent {
    return {
        messageId,
        channelId,
        guildId: reaction.guildId,
        userId: userId || user.id,
        emojiKey: reaction.emojiIdentifier,
    };
}

function normalizeMemberEvent(member: GuildMember): FluxerBotMemberEvent {
    return {
        guildId: member.guild.id,
        userId: member.id,
        roleIds: [...member.roles.roleIds],
    };
}

function normalizeBanEvent(ban: GuildBan): FluxerBotBanEvent {
    return {
        guildId: ban.guildId,
        userId: ban.user.id,
    };
}

function normalizeRoleEvent(event: {
    guild_id?: string;
    role?: { id?: string };
    role_id?: string;
}): FluxerBotRoleEvent {
    return {
        guildId: event.guild_id ?? '',
        roleId: event.role?.id ?? event.role_id ?? '',
    };
}

function normalizeChannelEvent(channel: Channel): FluxerBotChannelEvent {
    const possibleGuildChannel = channel as Channel & { guildId?: string };

    return {
        guildId: possibleGuildChannel.guildId ?? null,
        channelId: channel.id,
        channelType: channel.type,
    };
}

async function runLifecycleHandler<TEvent>(
    logger: AppLogger,
    logEvent: string,
    handler: FluxerBotEventHandler<TEvent> | undefined,
    event: TEvent,
    getLogContext: (event: TEvent) => Record<string, unknown> = createGenericLogContext
): Promise<void> {
    if (!handler) {
        return;
    }

    try {
        await handler(event);
    } catch {
        logger.error(logEvent, getLogContext(event));
    }
}

function createMessageLogContext(event: FluxerBotMessageEvent): Record<string, unknown> {
    return {
        messageId: event.messageId,
        channelId: event.channelId,
        guildId: event.guildId,
    };
}

function createDeletedMessageLogContext(event: FluxerBotMessageDeletedEvent): Record<string, unknown> {
    return {
        messageId: event.messageId,
        channelId: event.channelId,
        guildId: event.guildId,
    };
}

function createGenericLogContext(event: unknown): Record<string, unknown> {
    if (typeof event === 'object' && event !== null) {
        return event as Record<string, unknown>;
    }

    return {};
}
