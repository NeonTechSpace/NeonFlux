import {
    Events,
    GatewayOpcodes,
    PermissionFlags,
    type Channel,
    type Guild,
    type GuildBan,
    type GuildMember,
    type Message,
    type MessageReaction,
    type PartialMessage,
    type User,
} from '@fluxerjs/core';
import type { AppLogger } from '@neonflux/core/logging';
import { describe, expect, it, vi } from 'vitest';

import {
    createFluxerBot,
    type FluxerBotConfig,
    type FluxerBotBanEvent,
    type FluxerBotChannelEvent,
    type FluxerBotGuildEvent,
    type FluxerBotMemberEvent,
    type FluxerBotMessageEvent,
    type FluxerBotMessageDeletedEvent,
    type FluxerBotMessageUpdatedEvent,
    type FluxerBotReactionEvent,
    type FluxerBotRoleEvent,
    type FluxerBotVoiceStateEvent,
} from './client.js';

describe('createFluxerBot lifecycle handlers', () => {
    it('leaves startup presence unset until the ready event can push it explicitly', () => {
        const bot = createFluxerBot(createConfig(), createLogger());

        expect(bot.client.options.presence).toBeUndefined();
    });

    it('calls guildCreated with only the guild id on GuildCreate', () => {
        const guildCreated = vi.fn<(event: FluxerBotGuildEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            guildCreated,
        });

        bot.client.emit(Events.GuildCreate, createGuild('guild-1'));

        const event = guildCreated.mock.calls[0]?.[0];

        expect(event).toStrictEqual({
            guildId: 'guild-1',
        });
        expect(event ? Object.keys(event) : []).toStrictEqual(['guildId']);
    });

    it('calls guildDeleted with only the guild id on GuildDelete', () => {
        const guildDeleted = vi.fn<(event: FluxerBotGuildEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            guildDeleted,
        });

        bot.client.emit(Events.GuildDelete, createGuild('guild-1'));

        const event = guildDeleted.mock.calls[0]?.[0];

        expect(event).toStrictEqual({
            guildId: 'guild-1',
        });
        expect(event ? Object.keys(event) : []).toStrictEqual(['guildId']);
    });

    it('calls guildUpdated with only the new guild id on GuildUpdate', () => {
        const guildUpdated = vi.fn<(event: FluxerBotGuildEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            guildUpdated,
        });

        bot.client.emit(Events.GuildUpdate, createGuild('old-guild'), createGuild('guild-1'));

        expect(guildUpdated).toHaveBeenCalledWith({
            guildId: 'guild-1',
        });
    });

    it('catches and logs guild handler failures', async () => {
        const logger = createLogger();
        const handlerError = new Error('handler failed');
        const bot = createFluxerBot(createConfig(), logger, {
            guildCreated: () => Promise.reject(handlerError),
        });

        bot.client.emit(Events.GuildCreate, createGuild('guild-1'));
        await settleAsyncHandler();

        expect(logger.error).toHaveBeenCalledWith('fluxer.guild_created_handler_failed', {
            guildId: 'guild-1',
        });
    });

    it('treats guild events without handlers as harmless', () => {
        const logger = createLogger();
        const bot = createFluxerBot(createConfig(), logger);

        expect(() => {
            bot.client.emit(Events.GuildCreate, createGuild('guild-1'));
            bot.client.emit(Events.GuildDelete, createGuild('guild-1'));
        }).not.toThrow();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('syncs current bot guilds after the ready event exposes the bot user', async () => {
        const guildsReady = vi.fn<(event: { guildIds: string[] }) => void>();
        const logger = createLogger();
        const bot = createFluxerBot(
            {
                ...createConfig(),
                fluxerBotToken: 'bot-token',
            },
            logger,
            {
                guildsReady,
            }
        );
        const fetchGuilds = vi.fn().mockResolvedValue([createGuild('guild-1'), createGuild('guild-2')]);
        const sendToGateway = vi.spyOn(bot.client, 'sendToGateway').mockImplementation(() => undefined);

        vi.spyOn(bot.client, 'login').mockResolvedValue('bot-user');
        Object.defineProperty(bot.client, 'user', {
            configurable: true,
            value: {
                fetchGuilds,
            },
        });

        await bot.start();

        expect(guildsReady).not.toHaveBeenCalled();

        bot.client.emit(Events.Ready);
        await settleAsyncHandler();

        expect(logger.info).toHaveBeenCalledWith('fluxer.ready', {
            instanceMode: 'multi',
        });
        expect(sendToGateway).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalledWith('fluxer.presence_updated', expect.anything());
        expect(fetchGuilds).toHaveBeenCalledTimes(1);
        expect(guildsReady).toHaveBeenCalledWith({
            guildIds: ['guild-1', 'guild-2'],
        });
    });

    it('does not push a custom status when no custom status text is configured', () => {
        const bot = createFluxerBot(createConfig(), createLogger());
        const sendToGateway = vi.spyOn(bot.client, 'sendToGateway').mockImplementation(() => undefined);

        bot.client.emit(Events.Ready);

        expect(sendToGateway).not.toHaveBeenCalled();
    });

    it('uses configured custom status text on the ready presence update', () => {
        const logger = createLogger();
        const bot = createFluxerBot(
            {
                ...createConfig(),
                customStatusText: 'Testing NeonFlux',
            },
            logger
        );
        const sendToGateway = vi.spyOn(bot.client, 'sendToGateway').mockImplementation(() => undefined);

        bot.client.emit(Events.Ready);

        expect(sendToGateway).toHaveBeenCalledWith(0, {
            op: GatewayOpcodes.PresenceUpdate,
            d: {
                status: 'online',
                custom_status: {
                    text: 'Testing NeonFlux',
                },
            },
        });
    });

    it('calls messageCreated with normalized message data on MessageCreate', () => {
        const messageCreated = vi.fn<(event: FluxerBotMessageEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            messageCreated,
        });

        bot.client.emit(
            Events.MessageCreate,
            createMessage({
                mentions: [createUser('mentioned-1'), createUser('mentioned-2')],
            })
        );

        const event = messageCreated.mock.calls[0]?.[0];

        expect(event).toStrictEqual({
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            authorId: 'author-1',
            authorIsBot: false,
            authorRoleIds: [],
            authorIsServerOwner: false,
            authorHasManageServer: false,
            content: '<@bot-user>',
            mentionedUserIds: ['mentioned-1', 'mentioned-2'],
        });
        expect(event ? Object.keys(event) : []).toStrictEqual([
            'messageId',
            'channelId',
            'guildId',
            'authorId',
            'authorIsBot',
            'authorRoleIds',
            'authorIsServerOwner',
            'authorHasManageServer',
            'content',
            'mentionedUserIds',
        ]);
    });

    it('normalizes cached author guild roles and Manage Server status on MessageCreate', () => {
        const messageCreated = vi.fn<(event: FluxerBotMessageEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            messageCreated,
        });

        bot.client.emit(
            Events.MessageCreate,
            createMessage({
                guild: createGuild('guild-1', {
                    ownerId: 'author-1',
                    members: new Map([
                        [
                            'author-1',
                            {
                                roles: {
                                    roleIds: ['role-1', 'role-2'],
                                },
                                permissions: {
                                    has: (permission: unknown) => permission === PermissionFlags.ManageGuild,
                                },
                            },
                        ],
                    ]),
                }),
            })
        );

        expect(messageCreated.mock.calls[0]?.[0]).toMatchObject({
            authorRoleIds: ['role-1', 'role-2'],
            authorIsServerOwner: true,
            authorHasManageServer: true,
        });
    });

    it('catches and logs message handler failures', async () => {
        const logger = createLogger();
        const bot = createFluxerBot(createConfig(), logger, {
            messageCreated: () => Promise.reject(new Error('handler failed')),
        });

        bot.client.emit(Events.MessageCreate, createMessage());
        await settleAsyncHandler();

        expect(logger.error).toHaveBeenCalledWith('fluxer.message_created_handler_failed', {
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
        });
    });

    it('treats message events without handlers as harmless', () => {
        const logger = createLogger();
        const bot = createFluxerBot(createConfig(), logger);

        expect(() => {
            bot.client.emit(Events.MessageCreate, createMessage());
        }).not.toThrow();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('calls messageUpdated with normalized message data and old content', () => {
        const messageUpdated = vi.fn<(event: FluxerBotMessageUpdatedEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            messageUpdated,
        });

        bot.client.emit(
            Events.MessageUpdate,
            createMessage({ content: 'old content' }),
            createMessage({ content: 'new content' })
        );

        expect(messageUpdated.mock.calls[0]?.[0]).toStrictEqual({
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            authorId: 'author-1',
            authorIsBot: false,
            authorRoleIds: [],
            authorIsServerOwner: false,
            authorHasManageServer: false,
            content: 'new content',
            mentionedUserIds: [],
            oldContent: 'old content',
        });
    });

    it('sets messageUpdated oldContent to null when no old message is available', () => {
        const messageUpdated = vi.fn<(event: FluxerBotMessageUpdatedEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            messageUpdated,
        });

        bot.client.emit(Events.MessageUpdate, null, createMessage({ content: 'new content' }));

        expect(messageUpdated.mock.calls[0]?.[0].oldContent).toBeNull();
    });

    it('calls messageDeleted with normalized partial message data', () => {
        const messageDeleted = vi.fn<(event: FluxerBotMessageDeletedEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            messageDeleted,
        });

        bot.client.emit(Events.MessageDelete, createPartialMessage());

        expect(messageDeleted.mock.calls[0]?.[0]).toStrictEqual({
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: null,
            authorId: 'author-1',
            content: 'deleted content',
        });
    });

    it('calls reaction handlers with normalized reaction data', () => {
        const reactionAdded = vi.fn<(event: FluxerBotReactionEvent) => void>();
        const reactionRemoved = vi.fn<(event: FluxerBotReactionEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            reactionAdded,
            reactionRemoved,
        });

        bot.client.emit(
            Events.MessageReactionAdd,
            createReaction(),
            createUser('user-1'),
            'message-1',
            'channel-1',
            undefined,
            'reactor-1'
        );
        bot.client.emit(
            Events.MessageReactionRemove,
            createReaction({ emojiIdentifier: 'emoji:2' }),
            createUser('user-2'),
            'message-2',
            'channel-2',
            undefined,
            ''
        );

        expect(reactionAdded.mock.calls[0]?.[0]).toStrictEqual({
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'reactor-1',
            emojiKey: 'emoji:1',
        });
        expect(reactionRemoved.mock.calls[0]?.[0]).toStrictEqual({
            messageId: 'message-2',
            channelId: 'channel-2',
            guildId: 'guild-1',
            userId: 'user-2',
            emojiKey: 'emoji:2',
        });
    });

    it('calls member handlers with normalized member data', () => {
        const memberJoined = vi.fn<(event: FluxerBotMemberEvent) => void>();
        const memberUpdated = vi.fn<(event: FluxerBotMemberEvent) => void>();
        const memberLeft = vi.fn<(event: FluxerBotMemberEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            memberJoined,
            memberUpdated,
            memberLeft,
        });

        bot.client.emit(Events.GuildMemberAdd, createMember(['role-1']));
        bot.client.emit(Events.GuildMemberUpdate, createMember(['old-role']), createMember(['role-2', 'role-3']));
        bot.client.emit(Events.GuildMemberRemove, createMember([]));

        expect(memberJoined.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            userId: 'member-1',
            roleIds: ['role-1'],
        });
        expect(memberUpdated.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            userId: 'member-1',
            roleIds: ['role-2', 'role-3'],
        });
        expect(memberLeft.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            userId: 'member-1',
            roleIds: [],
        });
    });

    it('calls ban handlers with normalized ban data', () => {
        const banAdded = vi.fn<(event: FluxerBotBanEvent) => void>();
        const banRemoved = vi.fn<(event: FluxerBotBanEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            banAdded,
            banRemoved,
        });

        bot.client.emit(Events.GuildBanAdd, createBan('banned-1'));
        bot.client.emit(Events.GuildBanRemove, createBan('banned-2'));

        expect(banAdded.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            userId: 'banned-1',
        });
        expect(banRemoved.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            userId: 'banned-2',
        });
    });

    it('calls role handlers with normalized role data', () => {
        const roleCreated = vi.fn<(event: FluxerBotRoleEvent) => void>();
        const roleUpdated = vi.fn<(event: FluxerBotRoleEvent) => void>();
        const roleDeleted = vi.fn<(event: FluxerBotRoleEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            roleCreated,
            roleUpdated,
            roleDeleted,
        });

        bot.client.emit(Events.GuildRoleCreate, createRoleEvent('role-1'));
        bot.client.emit(Events.GuildRoleUpdate, createRoleEvent('role-2'));
        bot.client.emit(Events.GuildRoleDelete, {
            guild_id: 'guild-1',
            role_id: 'role-3',
        });

        expect(roleCreated.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            roleId: 'role-1',
        });
        expect(roleUpdated.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            roleId: 'role-2',
        });
        expect(roleDeleted.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            roleId: 'role-3',
        });
    });

    it('calls channel handlers with normalized channel data', () => {
        const channelCreated = vi.fn<(event: FluxerBotChannelEvent) => void>();
        const channelUpdated = vi.fn<(event: FluxerBotChannelEvent) => void>();
        const channelDeleted = vi.fn<(event: FluxerBotChannelEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            channelCreated,
            channelUpdated,
            channelDeleted,
        });

        bot.client.emit(Events.ChannelCreate, createChannel('channel-1', 0));
        bot.client.emit(Events.ChannelUpdate, createChannel('old-channel', 0), createChannel('channel-2', 2));
        bot.client.emit(Events.ChannelDelete, createChannel('channel-3', 4));

        expect(channelCreated.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            channelId: 'channel-1',
            channelType: 0,
        });
        expect(channelUpdated.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            channelId: 'channel-2',
            channelType: 2,
        });
        expect(channelDeleted.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            channelId: 'channel-3',
            channelType: 4,
        });
    });

    it('calls voiceStateUpdated with normalized voice state data', () => {
        const voiceStateUpdated = vi.fn<(event: FluxerBotVoiceStateEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            voiceStateUpdated,
        });

        bot.client.emit(Events.VoiceStateUpdate, {
            guild_id: 'guild-1',
            user_id: 'user-1',
            channel_id: 'voice-1',
        });

        expect(voiceStateUpdated.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            userId: 'user-1',
            channelId: 'voice-1',
            oldChannelId: null,
            oldChannelOccupancy: null,
        });
    });

    it('normalizes camelCase voice state data', () => {
        const voiceStateUpdated = vi.fn<(event: FluxerBotVoiceStateEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            voiceStateUpdated,
        });

        bot.client.emit(Events.VoiceStateUpdate, {
            guildId: 'guild-1',
            userId: 'user-1',
            channelId: 'voice-1',
        });

        expect(voiceStateUpdated.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            userId: 'user-1',
            channelId: 'voice-1',
            oldChannelId: null,
            oldChannelOccupancy: null,
        });
    });

    it('tracks previous voice channel occupancy from synced voice state data', () => {
        const voiceStateUpdated = vi.fn<(event: FluxerBotVoiceStateEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            voiceStateUpdated,
        });

        bot.client.emit(Events.VoiceStatesSync, {
            guildId: 'guild-1',
            voiceStates: [
                { user_id: 'user-1', channel_id: 'voice-1' },
                { user_id: 'user-2', channel_id: 'voice-1' },
            ],
        });
        bot.client.emit(Events.VoiceStateUpdate, {
            guild_id: 'guild-1',
            user_id: 'user-1',
            channel_id: 'voice-2',
        });
        bot.client.emit(Events.VoiceStateUpdate, {
            guild_id: 'guild-1',
            user_id: 'user-2',
            channel_id: null,
        });

        expect(voiceStateUpdated.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            userId: 'user-1',
            channelId: 'voice-2',
            oldChannelId: 'voice-1',
            oldChannelOccupancy: 1,
        });
        expect(voiceStateUpdated.mock.calls[1]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            userId: 'user-2',
            channelId: null,
            oldChannelId: 'voice-1',
            oldChannelOccupancy: 0,
        });
    });

    it('clears synced voice state data when a guild is recreated', () => {
        const voiceStateUpdated = vi.fn<(event: FluxerBotVoiceStateEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            voiceStateUpdated,
        });

        bot.client.emit(Events.VoiceStatesSync, {
            guildId: 'guild-1',
            voiceStates: [{ user_id: 'user-1', channel_id: 'voice-1' }],
        });
        bot.client.emit(Events.GuildCreate, createGuild('guild-1'));
        bot.client.emit(Events.VoiceStateUpdate, {
            guild_id: 'guild-1',
            user_id: 'user-1',
            channel_id: null,
        });

        expect(voiceStateUpdated.mock.calls[0]?.[0]).toStrictEqual({
            guildId: 'guild-1',
            userId: 'user-1',
            channelId: null,
            oldChannelId: null,
            oldChannelOccupancy: null,
        });
    });

    it('logs message-style handler failures for normalized update events', async () => {
        const logger = createLogger();
        const bot = createFluxerBot(createConfig(), logger, {
            messageUpdated: () => Promise.reject(new Error('handler failed')),
        });

        bot.client.emit(Events.MessageUpdate, null, createMessage());
        await settleAsyncHandler();

        expect(logger.error).toHaveBeenCalledWith('fluxer.message_updated_handler_failed', {
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
        });
    });

    it('logs generic handler failures for normalized channel events', async () => {
        const logger = createLogger();
        const bot = createFluxerBot(createConfig(), logger, {
            channelCreated: () => Promise.reject(new Error('handler failed')),
        });

        bot.client.emit(Events.ChannelCreate, createChannel('channel-1', 0));
        await settleAsyncHandler();

        expect(logger.error).toHaveBeenCalledWith('fluxer.channel_created_handler_failed', {
            guildId: 'guild-1',
            channelId: 'channel-1',
            channelType: 0,
        });
    });
});

function createGuild(id: string, overrides: Record<string, unknown> = {}): Guild {
    return {
        id,
        ...overrides,
    } as Guild;
}

function createMessage(overrides: Partial<Message> = {}): Message {
    return {
        id: 'message-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        author: createUser('author-1'),
        content: '<@bot-user>',
        mentions: [],
        ...overrides,
    } as Message;
}

function createPartialMessage(overrides: Partial<PartialMessage> = {}): PartialMessage {
    return {
        id: 'message-1',
        channelId: 'channel-1',
        authorId: 'author-1',
        content: 'deleted content',
        ...overrides,
    };
}

function createUser(id: string, overrides: Partial<User> = {}): User {
    return {
        id,
        bot: false,
        ...overrides,
    } as User;
}

function createReaction(overrides: Partial<MessageReaction> = {}): MessageReaction {
    return {
        guildId: 'guild-1',
        emojiIdentifier: 'emoji:1',
        ...overrides,
    } as MessageReaction;
}

function createMember(roleIds: string[]): GuildMember {
    return {
        id: 'member-1',
        guild: createGuild('guild-1'),
        roles: {
            roleIds,
        },
    } as unknown as GuildMember;
}

function createBan(userId: string): GuildBan {
    return {
        guildId: 'guild-1',
        user: createUser(userId),
    } as GuildBan;
}

function createRoleEvent(roleId: string) {
    return {
        guild_id: 'guild-1',
        role: {
            id: roleId,
        },
    };
}

function createChannel(id: string, type: number): Channel {
    return {
        id,
        guildId: 'guild-1',
        type,
    } as unknown as Channel;
}

function createConfig(): FluxerBotConfig {
    return {
        instanceMode: 'multi',
    };
}

function createLogger() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } satisfies AppLogger;
}

function settleAsyncHandler(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}
