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

export type FluxerBotGuildDeleteEvent = FluxerBotGuildEvent & {
    unavailable: boolean;
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
    userIsBot?: boolean;
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
    guildDeleted?: (event: FluxerBotGuildDeleteEvent) => void | Promise<void>;
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
const BOT_HANDLER_DRAIN_TIMEOUT_MS = 10_000;
const BOT_READY_TIMEOUT_MS = 30_000;
const CHANNEL_CACHE_LIMIT = 5_000;
const USER_CACHE_LIMIT = 10_000;

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
    const client = new Client({
        waitForGuilds: true,
        cache: {
            channels: CHANNEL_CACHE_LIMIT,
            guilds: config.instanceMode === 'single' ? 1 : 0,
            messages: 0,
            users: USER_CACHE_LIMIT,
        },
    });
    const configuredCustomStatusText = normalizeConfiguredCustomStatusText(config.customStatusText);
    const voiceStateCache: VoiceStateCache = new Map();
    const inFlightHandlers = new Set<Promise<void>>();
    let acceptingHandlers = true;
    let resolveReady: (() => void) | undefined;
    let rejectReady: ((error: unknown) => void) | undefined;
    const readyPromise = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });

    function runLifecycleHandler<TEvent>(
        handlerLogger: AppLogger,
        errorEvent: string,
        handler: FluxerBotEventHandler<TEvent> | undefined,
        event: TEvent,
        createLogContext: (event: TEvent) => Record<string, unknown> = createGenericLogContext
    ): void {
        if (!acceptingHandlers) return;

        const pending = executeLifecycleHandler(handlerLogger, errorEvent, handler, event, createLogContext);
        inFlightHandlers.add(pending);
        void pending.finally(() => {
            inFlightHandlers.delete(pending);
        });
    }

    client.once(Events.Ready, () => {
        logger.info('fluxer.ready', {
            instanceMode: config.instanceMode,
        });
        if (configuredCustomStatusText) {
            applyBotPresence(logger, client, configuredCustomStatusText);
        }
        const pending = runCurrentGuildSync(lifecycleHandlers.guildsReady, client);
        inFlightHandlers.add(pending);
        void pending
            .then(
                () => resolveReady?.(),
                (error: unknown) => {
                    logger.error('fluxer.guilds_ready_handler_failed');
                    rejectReady?.(error);
                }
            )
            .finally(() => {
                inFlightHandlers.delete(pending);
            });
    });

    client.on(Events.GuildCreate, (guild) => {
        voiceStateCache.delete(guild.id);
        runLifecycleHandler(logger, 'fluxer.guild_created_handler_failed', lifecycleHandlers.guildCreated, {
            guildId: guild.id,
        });
    });

    client.on(Events.GuildDelete, (guild, unavailable) => {
        voiceStateCache.delete(guild.id);
        runLifecycleHandler(logger, 'fluxer.guild_deleted_handler_failed', lifecycleHandlers.guildDeleted, {
            guildId: guild.id,
            unavailable,
        });
    });

    client.on(Events.GuildUpdate, (_oldGuild, newGuild) => {
        runLifecycleHandler(logger, 'fluxer.guild_updated_handler_failed', lifecycleHandlers.guildUpdated, {
            guildId: newGuild.id,
        });
    });

    client.on(Events.MessageCreate, (message) => {
        runLifecycleHandler(
            logger,
            'fluxer.message_created_handler_failed',
            lifecycleHandlers.messageCreated,
            normalizeMessageEvent(message),
            createMessageLogContext
        );
    });

    client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
        runLifecycleHandler(
            logger,
            'fluxer.message_updated_handler_failed',
            lifecycleHandlers.messageUpdated,
            normalizeMessageUpdatedEvent(oldMessage, newMessage),
            createMessageLogContext
        );
    });

    client.on(Events.MessageDelete, (message) => {
        runLifecycleHandler(
            logger,
            'fluxer.message_deleted_handler_failed',
            lifecycleHandlers.messageDeleted,
            normalizeMessageDeletedEvent(message),
            createDeletedMessageLogContext
        );
    });

    client.on(Events.MessageReactionAdd, (reaction, user, messageId, channelId, _emoji, userId) => {
        runLifecycleHandler(
            logger,
            'fluxer.reaction_added_handler_failed',
            lifecycleHandlers.reactionAdded,
            normalizeReactionEvent(reaction, user, messageId, channelId, userId)
        );
    });

    client.on(Events.MessageReactionRemove, (reaction, user, messageId, channelId, _emoji, userId) => {
        runLifecycleHandler(
            logger,
            'fluxer.reaction_removed_handler_failed',
            lifecycleHandlers.reactionRemoved,
            normalizeReactionEvent(reaction, user, messageId, channelId, userId)
        );
    });

    client.on(Events.GuildMemberAdd, (member) => {
        runLifecycleHandler(
            logger,
            'fluxer.member_joined_handler_failed',
            lifecycleHandlers.memberJoined,
            normalizeMemberEvent(member)
        );
    });

    client.on(Events.GuildMemberUpdate, (_oldMember, newMember) => {
        runLifecycleHandler(
            logger,
            'fluxer.member_updated_handler_failed',
            lifecycleHandlers.memberUpdated,
            normalizeMemberEvent(newMember)
        );
    });

    client.on(Events.GuildMemberRemove, (member) => {
        runLifecycleHandler(
            logger,
            'fluxer.member_left_handler_failed',
            lifecycleHandlers.memberLeft,
            normalizeMemberEvent(member)
        );
    });

    client.on(Events.GuildBanAdd, (ban) => {
        runLifecycleHandler(
            logger,
            'fluxer.ban_added_handler_failed',
            lifecycleHandlers.banAdded,
            normalizeBanEvent(ban)
        );
    });

    client.on(Events.GuildBanRemove, (ban) => {
        runLifecycleHandler(
            logger,
            'fluxer.ban_removed_handler_failed',
            lifecycleHandlers.banRemoved,
            normalizeBanEvent(ban)
        );
    });

    client.on(Events.GuildRoleCreate, (event) => {
        runLifecycleHandler(
            logger,
            'fluxer.role_created_handler_failed',
            lifecycleHandlers.roleCreated,
            normalizeRoleEvent(event)
        );
    });

    client.on(Events.GuildRoleUpdate, (event) => {
        runLifecycleHandler(
            logger,
            'fluxer.role_updated_handler_failed',
            lifecycleHandlers.roleUpdated,
            normalizeRoleEvent(event)
        );
    });

    client.on(Events.GuildRoleDelete, (event) => {
        runLifecycleHandler(
            logger,
            'fluxer.role_deleted_handler_failed',
            lifecycleHandlers.roleDeleted,
            normalizeRoleEvent(event)
        );
    });

    client.on(Events.ChannelCreate, (channel) => {
        runLifecycleHandler(
            logger,
            'fluxer.channel_created_handler_failed',
            lifecycleHandlers.channelCreated,
            normalizeChannelEvent(channel)
        );
    });

    client.on(Events.ChannelUpdate, (_oldChannel, newChannel) => {
        runLifecycleHandler(
            logger,
            'fluxer.channel_updated_handler_failed',
            lifecycleHandlers.channelUpdated,
            normalizeChannelEvent(newChannel)
        );
    });

    client.on(Events.ChannelDelete, (channel) => {
        runLifecycleHandler(
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
        runLifecycleHandler(
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
            await waitForReady(readyPromise, BOT_READY_TIMEOUT_MS);
            return true;
        },
        stopIntake(): void {
            acceptingHandlers = false;
        },
        async stop(): Promise<void> {
            acceptingHandlers = false;
            const drained = await drainInFlightHandlers(inFlightHandlers, BOT_HANDLER_DRAIN_TIMEOUT_MS);
            if (!drained) {
                logger.warn('fluxer.handler_drain_timeout', {
                    inFlightHandlerCount: inFlightHandlers.size,
                    timeoutMs: BOT_HANDLER_DRAIN_TIMEOUT_MS,
                });
            }
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
    handler: FluxerBotGuildsReadyEventHandler | undefined,
    client: Client
): Promise<void> {
    if (!handler) {
        return;
    }

    await handler({
        guildIds: [...client.guilds.keys()].sort(),
    });
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
        userIsBot: user.bot,
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

async function executeLifecycleHandler<TEvent>(
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

async function drainInFlightHandlers(inFlightHandlers: Set<Promise<void>>, timeoutMs: number): Promise<boolean> {
    if (inFlightHandlers.size === 0) return true;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutResult = new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
    });
    const drainResult = Promise.allSettled([...inFlightHandlers]).then(() => true as const);
    const drained = await Promise.race([drainResult, timeoutResult]);

    if (timeout) clearTimeout(timeout);
    return drained;
}

async function waitForReady(readyPromise: Promise<void>, timeoutMs: number): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutResult = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Fluxer bot readiness timed out.')), timeoutMs);
    });

    try {
        await Promise.race([readyPromise, timeoutResult]);
    } finally {
        if (timeout) clearTimeout(timeout);
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
