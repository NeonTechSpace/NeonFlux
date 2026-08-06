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
    editFluxerBotGuildChannelMessage,
    editFluxerChannelMessage,
    editFluxerGuildChannelMessage,
    sendDashboardFluxerMessage,
    sendFluxerBotChannelMessage,
    sendFluxerChannelMessage,
    sendFluxerGuildChannelMessage,
    type EditFluxerBotGuildChannelMessageError,
    type EditFluxerChannelMessageError,
    type EditFluxerChannelMessageInput,
    type EditFluxerGuildChannelMessageError,
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

    it('passes an explicit allowed-mentions policy to the SDK', async () => {
        const sendMock = createSendMock();

        const result = await sendFluxerChannelMessage({
            allowedMentions: { parse: [] },
            client: createClient(sendMock),
            channelId: 'channel-1',
            content: '@everyone',
        });

        expect(result.isOk()).toBe(true);
        expect(sendMock).toHaveBeenCalledWith('channel-1', {
            allowedMentions: { parse: [] },
            content: '@everyone',
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
                description: null,
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

describe('sendDashboardFluxerMessage', () => {
    it('translates the domain contract and always suppresses mentions', async () => {
        const sendMock = createSendMock();

        const result = await sendDashboardFluxerMessage({
            client: createClient(sendMock),
            channelId: 'channel-1',
            message: {
                content: '@everyone launch',
                embeds: [
                    {
                        author: { name: 'NeonFlux', iconUrl: 'https://example.com/icon.png' },
                        footer: { text: 'Ready', iconUrl: 'https://example.com/footer.png' },
                        imageUrl: 'https://example.com/image.png',
                        title: 'Launch',
                    },
                ],
            },
        });

        expect(result.isOk()).toBe(true);
        expect(sendMock).toHaveBeenCalledWith('channel-1', {
            allowedMentions: { parse: [] },
            content: '@everyone launch',
            embeds: [
                {
                    author: { name: 'NeonFlux', icon_url: 'https://example.com/icon.png' },
                    description: null,
                    footer: { text: 'Ready', icon_url: 'https://example.com/footer.png' },
                    image: { url: 'https://example.com/image.png' },
                    title: 'Launch',
                },
            ],
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

    it('uses a REST-only authenticated client, sends the message, and destroys the temporary client', async () => {
        const login = vi.spyOn(Client.prototype, 'login');
        const destroy = vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);
        const send = vi.spyOn(ChannelManager.prototype, 'send').mockResolvedValue(createMessage());

        const result = await sendFluxerBotChannelMessage({
            botToken: ' bot-token ',
            channelId: 'channel-1',
            content: 'hello',
        });

        expect(result.isOk()).toBe(true);
        expect(login).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith('channel-1', { content: 'hello' });
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('rejects missing bot tokens before creating a gateway session', async () => {
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
});

describe('editFluxerChannelMessage', () => {
    it('fetches the trimmed message and edits it with the normalized payload', async () => {
        const edit = vi.fn<(payload: MessageSendOptions) => Promise<Message>>().mockResolvedValue(createMessage());
        const fetchMessage = vi
            .fn<(channelId: string, messageId: string) => Promise<{ edit: typeof edit }>>()
            .mockResolvedValue({ edit });

        const result = await editFluxerChannelMessage({
            client: createEditClient(fetchMessage),
            channelId: ' channel-1 ',
            messageId: ' message-1 ',
            content: ' updated content ',
        });

        expect(result.isOk()).toBe(true);
        expect(fetchMessage).toHaveBeenCalledWith('channel-1', 'message-1');
        expect(edit).toHaveBeenCalledWith({ content: 'updated content' });
        expect(result._unsafeUnwrap()).toStrictEqual({
            id: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
        });
    });

    it('rejects empty edit payloads before fetching the message', async () => {
        const fetchMessage = createFetchMessageMock();

        const result = await editFluxerChannelMessage({
            client: createEditClient(fetchMessage),
            channelId: 'channel-1',
            messageId: 'message-1',
            content: '   ',
            embeds: [],
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'message',
        } satisfies EditFluxerChannelMessageError);
        expect(fetchMessage).not.toHaveBeenCalled();
    });

    it('maps SDK edit rejections to edit-failed', async () => {
        const editError = new Error('missing access');
        const edit = vi.fn<(payload: MessageSendOptions) => Promise<Message>>().mockRejectedValue(editError);
        const fetchMessage = createFetchMessageMock(Promise.resolve({ edit }));

        const result = await editFluxerChannelMessage({
            client: createEditClient(fetchMessage),
            channelId: 'channel-1',
            messageId: 'message-1',
            content: 'updated',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'edit-failed',
            error: editError,
        } satisfies EditFluxerChannelMessageError);
    });
});

describe('editFluxerGuildChannelMessage', () => {
    it('edits only after verifying the channel belongs to the guild', async () => {
        const edit = vi.fn<(payload: MessageSendOptions) => Promise<Message>>().mockResolvedValue(createMessage());
        const fetchMessage = createFetchMessageMock(Promise.resolve({ edit }));
        const guild = createGuild({ channels: [createChannel({ id: 'channel-1' })] });
        const fetchGuild = createFetchGuildMock(Promise.resolve(guild));

        const result = await editFluxerGuildChannelMessage({
            client: createGuildAwareEditClient({ fetchGuild, fetchMessage }),
            guildId: ' guild-1 ',
            channelId: ' channel-1 ',
            messageId: ' message-1 ',
            content: 'updated',
        });

        expect(result.isOk()).toBe(true);
        expect(fetchGuild).toHaveBeenCalledWith('guild-1');
        expect(fetchMessage).toHaveBeenCalledWith('channel-1', 'message-1');
        expect(edit).toHaveBeenCalledWith({ content: 'updated' });
    });

    it('rejects edits outside the authorized guild before fetching the message', async () => {
        const fetchMessage = createFetchMessageMock();

        const result = await editFluxerGuildChannelMessage({
            client: createGuildAwareEditClient({
                fetchGuild: createFetchGuildMock(Promise.resolve(createGuild({ channels: [createChannel()] }))),
                fetchMessage,
            }),
            guildId: 'guild-1',
            channelId: 'other-channel',
            messageId: 'message-1',
            content: 'updated',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'channel-not-in-guild',
        } satisfies EditFluxerGuildChannelMessageError);
        expect(fetchMessage).not.toHaveBeenCalled();
    });
});

describe('editFluxerBotGuildChannelMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses a REST-only authenticated client, edits the message, and destroys the temporary client', async () => {
        const edit = vi.fn<(payload: MessageSendOptions) => Promise<Message>>().mockResolvedValue(createMessage());
        const fetchGuild = createFetchGuildMock(
            Promise.resolve(createGuild({ channels: [createChannel({ id: 'channel-1' })] }))
        );
        const fetchMessage = vi
            .spyOn(ChannelManager.prototype, 'fetchMessage')
            .mockResolvedValue({ edit } as unknown as Message);
        const managerOwner = new Client();
        vi.spyOn(
            Object.getPrototypeOf(managerOwner.guilds) as { fetch: typeof fetchGuild },
            'fetch'
        ).mockImplementation(fetchGuild);
        const login = vi.spyOn(Client.prototype, 'login');
        const destroy = vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await editFluxerBotGuildChannelMessage({
            botToken: ' bot-token ',
            guildId: ' guild-1 ',
            channelId: ' channel-1 ',
            messageId: ' message-1 ',
            content: 'updated',
        });

        expect(result.isOk()).toBe(true);
        expect(login).not.toHaveBeenCalled();
        expect(fetchGuild).toHaveBeenCalledWith('guild-1');
        expect(fetchMessage).toHaveBeenCalledWith('channel-1', 'message-1');
        expect(edit).toHaveBeenCalledWith({ content: 'updated' });
        expect(destroy).toHaveBeenCalledOnce();
        await managerOwner.destroy();
    });

    it('rejects missing bot tokens before login', async () => {
        const login = vi.spyOn(Client.prototype, 'login');

        const result = await editFluxerBotGuildChannelMessage({
            botToken: '   ',
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
            content: 'updated',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'botToken',
        } satisfies EditFluxerBotGuildChannelMessageError);
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
type FetchMessageMock = ReturnType<
    typeof vi.fn<
        (channelId: string, messageId: string) => Promise<{ edit: (payload: MessageSendOptions) => Promise<Message> }>
    >
>;

function createSendMock(result: Promise<Message> = Promise.resolve(createMessage())): SendMock {
    return vi
        .fn<(channelId: string, payload: string | MessageSendOptions) => Promise<Message>>()
        .mockReturnValue(result);
}

function createFetchGuildMock(result: Promise<Guild | null>): FetchGuildMock {
    return vi.fn<(guildId: string) => Promise<Guild | null>>().mockReturnValue(result);
}

function createFetchMessageMock(
    result: Promise<{ edit: (payload: MessageSendOptions) => Promise<Message> }> = Promise.resolve({
        edit: vi.fn(),
    })
): FetchMessageMock {
    return vi
        .fn<
            (
                channelId: string,
                messageId: string
            ) => Promise<{ edit: (payload: MessageSendOptions) => Promise<Message> }>
        >()
        .mockReturnValue(result);
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

function createEditClient(fetchMessage: FetchMessageMock): EditFluxerChannelMessageInput['client'] {
    return {
        channels: {
            fetchMessage,
        },
    } as unknown as EditFluxerChannelMessageInput['client'];
}

function createGuildAwareEditClient(input: {
    fetchGuild: FetchGuildMock;
    fetchMessage: FetchMessageMock;
}): Parameters<typeof editFluxerGuildChannelMessage>[0]['client'] {
    return {
        channels: {
            fetchMessage: input.fetchMessage,
        },
        guilds: {
            fetch: input.fetchGuild,
        },
    } as unknown as Parameters<typeof editFluxerGuildChannelMessage>[0]['client'];
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
