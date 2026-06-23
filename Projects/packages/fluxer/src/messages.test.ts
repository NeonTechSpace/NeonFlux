import type { Message, MessageSendOptions } from '@fluxerjs/core';
import { describe, expect, it, vi } from 'vitest';

import {
    sendFluxerChannelMessage,
    type SendFluxerChannelMessageInput,
    type SendFluxerChannelMessageError,
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

function createClient(sendMock: SendMock): SendFluxerChannelMessageInput['client'] {
    return {
        channels: {
            send: sendMock,
        },
    } as unknown as SendFluxerChannelMessageInput['client'];
}

type SendMock = ReturnType<typeof vi.fn<(channelId: string, payload: string | MessageSendOptions) => Promise<Message>>>;

function createSendMock(result: Promise<Message> = Promise.resolve(createMessage())): SendMock {
    return vi
        .fn<(channelId: string, payload: string | MessageSendOptions) => Promise<Message>>()
        .mockReturnValue(result);
}

function createMessage(overrides: Partial<Message> = {}): Message {
    return {
        id: 'message-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        content: 'hello',
        ...overrides,
    } as Message;
}
