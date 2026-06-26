import type { Message, MessageSendOptions } from '@fluxerjs/core';
import { describe, expect, it, vi } from 'vitest';

import { createFluxerPlatform, type FluxerPlatformError } from './platform.js';

describe('createFluxerPlatform', () => {
    it('sends messages through the normalized messages port', async () => {
        const send = vi.fn<(channelId: string, payload: string | MessageSendOptions) => Promise<Message>>();
        send.mockResolvedValue(createMessage());

        const platform = createFluxerPlatform(
            createClient({
                channels: {
                    send,
                },
            })
        );

        const result = await platform.messages.send({
            channelId: ' channel-1 ',
            content: ' hello ',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            id: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
        });
        expect(send).toHaveBeenCalledWith('channel-1', {
            content: 'hello',
        });
    });

    it('fetches messages without exposing SDK message objects', async () => {
        const fetch = vi.fn<(messageId: string) => Promise<Message>>();
        fetch.mockResolvedValue(createMessage());
        const platform = createFluxerPlatform(
            createClient({
                channels: {
                    resolve: vi.fn().mockResolvedValue({
                        messages: {
                            fetch,
                        },
                    }),
                },
            })
        );

        const result = await platform.messages.fetch({
            channelId: ' channel-1 ',
            messageId: ' message-1 ',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            id: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
        });
        expect(fetch).toHaveBeenCalledWith('message-1');
    });

    it('rejects missing required platform inputs before calling the SDK', async () => {
        const resolve = vi.fn();
        const platform = createFluxerPlatform(
            createClient({
                channels: {
                    resolve,
                },
            })
        );

        const result = await platform.messages.fetch({
            channelId: '   ',
            messageId: 'message-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'channelId',
        } satisfies FluxerPlatformError);
        expect(resolve).not.toHaveBeenCalled();
    });

    it('rejects empty message edit payloads before fetching the message', async () => {
        const resolve = vi.fn();
        const platform = createFluxerPlatform(
            createClient({
                channels: {
                    resolve,
                },
            })
        );

        const result = await platform.messages.edit({
            channelId: 'channel-1',
            messageId: 'message-1',
            content: '   ',
            embeds: [],
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'message',
        } satisfies FluxerPlatformError);
        expect(resolve).not.toHaveBeenCalled();
    });

    it('rejects blank reaction emoji before fetching the message', async () => {
        const resolve = vi.fn();
        const platform = createFluxerPlatform(
            createClient({
                channels: {
                    resolve,
                },
            })
        );

        const result = await platform.messages.react({
            channelId: 'channel-1',
            messageId: 'message-1',
            emoji: '   ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'emoji',
        } satisfies FluxerPlatformError);
        expect(resolve).not.toHaveBeenCalled();
    });

    it('rejects blank moderation targets before fetching the guild', async () => {
        const fetch = vi.fn();
        const platform = createFluxerPlatform(
            createClient({
                guilds: {
                    fetch,
                },
            })
        );

        const result = await platform.moderation.ban({
            guildId: 'guild-1',
            userId: '   ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'userId',
        } satisfies FluxerPlatformError);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects blank role names before fetching the guild', async () => {
        const fetch = vi.fn();
        const platform = createFluxerPlatform(
            createClient({
                guilds: {
                    fetch,
                },
            })
        );

        const result = await platform.roles.create({
            guildId: 'guild-1',
            name: '   ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'name',
        } satisfies FluxerPlatformError);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('maps SDK permission errors to permission-denied', async () => {
        const platform = createFluxerPlatform(
            createClient({
                channels: {
                    resolve: vi.fn().mockRejectedValue({
                        statusCode: 403,
                    }),
                },
            })
        );

        const result = await platform.messages.delete({
            channelId: 'channel-1',
            messageId: 'message-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'permission-denied',
        } satisfies FluxerPlatformError);
    });

    it('maps SDK not-found errors to not-found', async () => {
        const platform = createFluxerPlatform(
            createClient({
                guilds: {
                    fetch: vi.fn().mockRejectedValue({
                        status: 404,
                    }),
                },
            })
        );

        const result = await platform.members.addRole({
            guildId: 'guild-1',
            userId: 'user-1',
            roleId: 'role-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'not-found',
        } satisfies FluxerPlatformError);
    });

    it('maps unexpected SDK failures to operation-failed', async () => {
        const sdkError = new Error('network failed');
        const platform = createFluxerPlatform(
            createClient({
                channels: {
                    fetch: vi.fn().mockRejectedValue(sdkError),
                },
            })
        );

        const result = await platform.messages.bulkDelete({
            channelId: 'channel-1',
            messageIds: ['message-1'],
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'operation-failed',
            error: sdkError,
        } satisfies FluxerPlatformError);
    });
});

function createClient(overrides: Record<string, unknown>) {
    return overrides as unknown as Parameters<typeof createFluxerPlatform>[0];
}

function createMessage(overrides: Partial<Message> = {}): Message {
    return {
        id: 'message-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        ...overrides,
    } as Message;
}
