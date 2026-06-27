import {
    ChannelManager,
    Client,
    type Guild,
    type GuildChannel,
    type Message,
    type MessageSendOptions,
    type Role,
} from '@fluxerjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    reactFluxerBotGuildChannelMessage,
    reactFluxerChannelMessage,
    reactFluxerGuildChannelMessage,
    sendFluxerBotChannelMessage,
    sendFluxerChannelMessage,
    sendFluxerGuildChannelMessage,
    type ReactFluxerBotGuildChannelMessageError,
    type ReactFluxerChannelMessageError,
    type ReactFluxerChannelMessageInput,
    type ReactFluxerGuildChannelMessageError,
    type SendFluxerChannelMessageInput,
    type SendFluxerChannelMessageError,
    type SendFluxerBotChannelMessageError,
    type SendFluxerGuildChannelMessageError,
} from './messages.js';

describe('sendFluxerChannelMessage', () => {
    it('sends text content to the trimmed channel id', async () => {
        const sendMock = createSendMock();

        const result = await sendFluxerChannelMessage({
            client: createClient(sendMock),
            channelId: ' channel-1 ',
            content: 'hello',
        });

        expect(result.isOk()).toBe(true);
        expect(sendMock).toHaveBeenCalledWith('channel-1', {
            content: 'hello',
        });
    });

    it('sends embeds without content', async () => {
        const sendMock = createSendMock();
        const embeds: NonNullable<MessageSendOptions['embeds']> = [
            {
                title: 'NeonFlux',
                description: 'Status update',
            },
        ];

        const result = await sendFluxerChannelMessage({
            client: createClient(sendMock),
            channelId: 'channel-1',
            embeds,
        });

        expect(result.isOk()).toBe(true);
        expect(sendMock).toHaveBeenCalledWith('channel-1', {
            embeds,
        });
    });

    it('sends content and embeds together', async () => {
        const sendMock = createSendMock();
        const embeds: NonNullable<MessageSendOptions['embeds']> = [
            {
                title: 'NeonFlux',
            },
        ];

        const result = await sendFluxerChannelMessage({
            client: createClient(sendMock),
            channelId: 'channel-1',
            content: 'hello',
            embeds,
        });

        expect(result.isOk()).toBe(true);
        expect(sendMock).toHaveBeenCalledWith('channel-1', {
            content: 'hello',
            embeds,
        });
    });

    it('trims content before sending', async () => {
        const sendMock = createSendMock();

        const result = await sendFluxerChannelMessage({
            client: createClient(sendMock),
            channelId: 'channel-1',
            content: '  trimmed content  ',
        });

        expect(result.isOk()).toBe(true);
        expect(sendMock).toHaveBeenCalledWith('channel-1', {
            content: 'trimmed content',
        });
    });

    it('rejects blank channel ids before sending', async () => {
        const sendMock = createSendMock();

        const result = await sendFluxerChannelMessage({
            client: createClient(sendMock),
            channelId: '   ',
            content: 'hello',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'channelId',
        } satisfies SendFluxerChannelMessageError);
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('rejects empty message payloads before sending', async () => {
        const sendMock = createSendMock();

        const result = await sendFluxerChannelMessage({
            client: createClient(sendMock),
            channelId: 'channel-1',
            content: '   ',
            embeds: [],
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'message',
        } satisfies SendFluxerChannelMessageError);
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('maps SDK send rejections to send-failed', async () => {
        const sendError = new Error('missing access');
        const sendMock = createSendMock(Promise.reject(sendError));

        const result = await sendFluxerChannelMessage({
            client: createClient(sendMock),
            channelId: 'channel-1',
            content: 'hello',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'send-failed',
            error: sendError,
        } satisfies SendFluxerChannelMessageError);
    });

    it('returns only normalized message metadata', async () => {
        const result = await sendFluxerChannelMessage({
            client: createClient(createSendMock()),
            channelId: 'channel-1',
            content: 'hello',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            id: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
        });
        expect(Object.keys(result._unsafeUnwrap())).toStrictEqual(['id', 'channelId', 'guildId']);
    });

    it('returns null for messages without a guild id', async () => {
        const result = await sendFluxerChannelMessage({
            client: createClient(createSendMock(Promise.resolve(createMessage({ guildId: null })))),
            channelId: 'channel-1',
            content: 'hello',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            id: 'message-1',
            channelId: 'channel-1',
            guildId: null,
        });
    });
});

describe('sendFluxerGuildChannelMessage', () => {
    it('sends only after verifying the channel belongs to the guild', async () => {
        const sendMock = createSendMock();
        const guild = createGuild({ channels: [createChannel({ id: 'channel-1' })] });
        const fetchGuild = createFetchGuildMock(Promise.resolve(guild));

        const result = await sendFluxerGuildChannelMessage({
            client: createGuildAwareClient({ fetchGuild, sendMock }),
            guildId: ' guild-1 ',
            channelId: ' channel-1 ',
            content: 'hello',
        });

        expect(result.isOk()).toBe(true);
        expect(fetchGuild).toHaveBeenCalledWith('guild-1');
        expect(sendMock).toHaveBeenCalledWith('channel-1', { content: 'hello' });
    });

    it('rejects channels outside the authorized guild before sending', async () => {
        const sendMock = createSendMock();

        const result = await sendFluxerGuildChannelMessage({
            client: createGuildAwareClient({
                fetchGuild: createFetchGuildMock(Promise.resolve(createGuild({ channels: [createChannel()] }))),
                sendMock,
            }),
            guildId: 'guild-1',
            channelId: 'other-channel',
            content: 'hello',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'channel-not-in-guild',
        } satisfies SendFluxerGuildChannelMessageError);
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('maps guild lookup failures before sending', async () => {
        const fetchError = new Error('guild fetch failed');
        const sendMock = createSendMock();

        const result = await sendFluxerGuildChannelMessage({
            client: createGuildAwareClient({
                fetchGuild: createFetchGuildMock(Promise.reject(fetchError)),
                sendMock,
            }),
            guildId: 'guild-1',
            channelId: 'channel-1',
            content: 'hello',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'guild-lookup-failed',
            error: fetchError,
        } satisfies SendFluxerGuildChannelMessageError);
        expect(sendMock).not.toHaveBeenCalled();
    });
});

describe('sendFluxerBotChannelMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('logs in with the bot token, sends the message, and destroys the temporary client', async () => {
        const login = vi.spyOn(Client.prototype, 'login').mockResolvedValue('session-id');
        const destroy = vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);
        const send = vi.spyOn(ChannelManager.prototype, 'send').mockResolvedValue(createMessage());

        const result = await sendFluxerBotChannelMessage({
            botToken: ' bot-token ',
            channelId: 'channel-1',
            content: 'hello',
        });

        expect(result.isOk()).toBe(true);
        expect(login).toHaveBeenCalledWith('bot-token');
        expect(send).toHaveBeenCalledWith('channel-1', { content: 'hello' });
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('rejects missing bot tokens before login', async () => {
        const login = vi.spyOn(Client.prototype, 'login');

        const result = await sendFluxerBotChannelMessage({
            botToken: '   ',
            channelId: 'channel-1',
            content: 'hello',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'botToken',
        } satisfies SendFluxerBotChannelMessageError);
        expect(login).not.toHaveBeenCalled();
    });

    it('maps login failures without calling send', async () => {
        const loginError = new Error('bad token');
        vi.spyOn(Client.prototype, 'login').mockRejectedValue(loginError);
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);
        const send = vi.spyOn(ChannelManager.prototype, 'send');

        const result = await sendFluxerBotChannelMessage({
            botToken: 'bot-token',
            channelId: 'channel-1',
            content: 'hello',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'login-failed',
            error: loginError,
        } satisfies SendFluxerBotChannelMessageError);
        expect(send).not.toHaveBeenCalled();
    });
});

describe('reactFluxerChannelMessage', () => {
    it('reacts to the trimmed channel message and emoji', async () => {
        const react = vi.fn<(emoji: string) => Promise<void>>().mockResolvedValue(undefined);
        const fetchMessage = vi.fn<(messageId: string) => Promise<{ react: typeof react }>>().mockResolvedValue({
            react,
        });
        const resolveChannel = createResolveChannelMock(
            Promise.resolve({
                messages: {
                    fetch: fetchMessage,
                },
            })
        );

        const result = await reactFluxerChannelMessage({
            client: createReactClient(resolveChannel),
            channelId: ' channel-1 ',
            messageId: ' message-1 ',
            emoji: ' ✅ ',
        });

        expect(result.isOk()).toBe(true);
        expect(resolveChannel).toHaveBeenCalledWith('channel-1');
        expect(fetchMessage).toHaveBeenCalledWith('message-1');
        expect(react).toHaveBeenCalledWith('✅');
    });

    it('rejects blank reaction inputs before fetching the message', async () => {
        const resolveChannel = createResolveChannelMock();

        const result = await reactFluxerChannelMessage({
            client: createReactClient(resolveChannel),
            channelId: 'channel-1',
            messageId: 'message-1',
            emoji: ' ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'emoji',
        } satisfies ReactFluxerChannelMessageError);
        expect(resolveChannel).not.toHaveBeenCalled();
    });

    it('maps reaction failures', async () => {
        const reactionError = new Error('missing reaction access');
        const react = vi.fn<(emoji: string) => Promise<void>>().mockRejectedValue(reactionError);
        const resolveChannel = createResolveChannelMock(
            Promise.resolve({
                messages: {
                    fetch: vi.fn().mockResolvedValue({ react }),
                },
            })
        );

        const result = await reactFluxerChannelMessage({
            client: createReactClient(resolveChannel),
            channelId: 'channel-1',
            messageId: 'message-1',
            emoji: '✅',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'react-failed',
            error: reactionError,
        } satisfies ReactFluxerChannelMessageError);
    });
});

describe('reactFluxerGuildChannelMessage', () => {
    it('reacts only after verifying the channel belongs to the guild', async () => {
        const react = vi.fn<(emoji: string) => Promise<void>>().mockResolvedValue(undefined);
        const resolveChannel = createResolveChannelMock(
            Promise.resolve({
                messages: {
                    fetch: vi.fn().mockResolvedValue({ react }),
                },
            })
        );
        const guild = createGuild({ channels: [createChannel({ id: 'channel-1' })] });
        const fetchGuild = createFetchGuildMock(Promise.resolve(guild));

        const result = await reactFluxerGuildChannelMessage({
            client: createGuildAwareReactClient({ fetchGuild, resolveChannel }),
            guildId: ' guild-1 ',
            channelId: ' channel-1 ',
            messageId: ' message-1 ',
            emoji: ' ✅ ',
        });

        expect(result.isOk()).toBe(true);
        expect(fetchGuild).toHaveBeenCalledWith('guild-1');
        expect(resolveChannel).toHaveBeenCalledWith('channel-1');
        expect(react).toHaveBeenCalledWith('✅');
    });

    it('rejects reactions outside the authorized guild', async () => {
        const resolveChannel = createResolveChannelMock();

        const result = await reactFluxerGuildChannelMessage({
            client: createGuildAwareReactClient({
                fetchGuild: createFetchGuildMock(Promise.resolve(createGuild({ channels: [createChannel()] }))),
                resolveChannel,
            }),
            guildId: 'guild-1',
            channelId: 'other-channel',
            messageId: 'message-1',
            emoji: '✅',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'channel-not-in-guild',
        } satisfies ReactFluxerGuildChannelMessageError);
        expect(resolveChannel).not.toHaveBeenCalled();
    });
});

describe('reactFluxerBotGuildChannelMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rejects missing bot tokens before login', async () => {
        const login = vi.spyOn(Client.prototype, 'login');

        const result = await reactFluxerBotGuildChannelMessage({
            botToken: '   ',
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
            emoji: '✅',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'botToken',
        } satisfies ReactFluxerBotGuildChannelMessageError);
        expect(login).not.toHaveBeenCalled();
    });
});

function createClient(sendMock: SendMock): SendFluxerChannelMessageInput['client'] {
    return {
        channels: {
            send: sendMock,
        },
    } as unknown as SendFluxerChannelMessageInput['client'];
}

type SendMock = ReturnType<typeof vi.fn<(channelId: string, payload: string | MessageSendOptions) => Promise<Message>>>;

type FetchGuildMock = ReturnType<typeof vi.fn<(guildId: string) => Promise<Guild | null>>>;
type ResolveChannelMock = ReturnType<typeof vi.fn<(channelId: string) => Promise<unknown>>>;

function createSendMock(result: Promise<Message> = Promise.resolve(createMessage())): SendMock {
    return vi
        .fn<(channelId: string, payload: string | MessageSendOptions) => Promise<Message>>()
        .mockReturnValue(result);
}

function createFetchGuildMock(result: Promise<Guild | null>): FetchGuildMock {
    return vi.fn<(guildId: string) => Promise<Guild | null>>().mockReturnValue(result);
}

function createResolveChannelMock(result: Promise<unknown> = Promise.resolve(undefined)): ResolveChannelMock {
    return vi.fn<(channelId: string) => Promise<unknown>>().mockReturnValue(result);
}

function createGuildAwareClient(input: {
    fetchGuild: FetchGuildMock;
    sendMock: SendMock;
}): Parameters<typeof sendFluxerGuildChannelMessage>[0]['client'] {
    return {
        channels: {
            send: input.sendMock,
        },
        guilds: {
            fetch: input.fetchGuild,
        },
    } as unknown as Parameters<typeof sendFluxerGuildChannelMessage>[0]['client'];
}

function createReactClient(resolveChannel: ResolveChannelMock): ReactFluxerChannelMessageInput['client'] {
    return {
        channels: {
            resolve: resolveChannel,
        },
    } as unknown as ReactFluxerChannelMessageInput['client'];
}

function createGuildAwareReactClient(input: {
    fetchGuild: FetchGuildMock;
    resolveChannel: ResolveChannelMock;
}): Parameters<typeof reactFluxerGuildChannelMessage>[0]['client'] {
    return {
        channels: {
            resolve: input.resolveChannel,
        },
        guilds: {
            fetch: input.fetchGuild,
        },
    } as unknown as Parameters<typeof reactFluxerGuildChannelMessage>[0]['client'];
}

type TestGuild = Guild & {
    fetchRoles: ReturnType<typeof vi.fn<() => Promise<Role[]>>>;
    fetchChannels: ReturnType<typeof vi.fn<() => Promise<GuildChannel[]>>>;
};

function createGuild(options: { roles?: Role[]; channels?: GuildChannel[] } = {}): TestGuild {
    return {
        fetchRoles: vi.fn<() => Promise<Role[]>>().mockReturnValue(Promise.resolve(options.roles ?? [createRole()])),
        fetchChannels: vi
            .fn<() => Promise<GuildChannel[]>>()
            .mockReturnValue(Promise.resolve(options.channels ?? [createChannel()])),
    } as unknown as TestGuild;
}

function createRole(): Role {
    return {
        id: 'role-1',
        name: 'Member',
        position: 1,
        color: 0,
        permissions: {
            valueOf: () => '64',
        },
        hoist: false,
        mentionable: false,
    } as unknown as Role;
}

function createChannel(overrides: Partial<MockChannel> = {}): GuildChannel {
    return {
        id: 'channel-1',
        name: 'general',
        type: 0,
        parentId: null,
        position: 1,
        permissionOverwrites: [],
        ...overrides,
    } as unknown as GuildChannel;
}

type MockChannel = {
    id: string;
    name: string | null;
    type: number;
    parentId: string | null;
    position?: number;
    permissionOverwrites: Array<{
        id: string;
        type: number;
        allow: string;
        deny: string;
    }>;
};

function createMessage(overrides: Partial<Message> = {}): Message {
    return {
        id: 'message-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        content: 'hello',
        ...overrides,
    } as Message;
}
