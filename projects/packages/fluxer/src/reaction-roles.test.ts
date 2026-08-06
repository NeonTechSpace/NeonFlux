import type { Message, MessageSendOptions } from '@fluxerjs/core';
import { describe, expect, it, vi } from 'vitest';

import { createFluxerReactionRolePlatform } from './reaction-roles.js';

describe('createFluxerReactionRolePlatform', () => {
    it('serializes reaction-role messages through the shared Fluxer embed contract', async () => {
        const send = vi
            .fn<(channelId: string, options: MessageSendOptions) => Promise<Message>>()
            .mockResolvedValue({ id: 'message-1', channelId: 'channel-1' } as Message);
        const platform = createFluxerReactionRolePlatform({ channels: { send } } as never);

        const result = await platform.send({
            channelId: 'channel-1',
            nonce: 'panel-1',
            message: {
                content: '@everyone choose a role',
                embeds: [
                    {
                        author: {
                            iconUrl: 'https://example.com/author.png',
                            name: 'Roles',
                        },
                        footer: {
                            iconUrl: 'https://example.com/footer.png',
                            text: 'One choice',
                        },
                        imageUrl: 'https://example.com/image.png',
                        thumbnailUrl: 'https://example.com/thumbnail.png',
                        title: 'Choose',
                    },
                ],
            },
        });

        expect(result._unsafeUnwrap()).toStrictEqual({ channelId: 'channel-1', id: 'message-1' });
        expect(send).toHaveBeenCalledWith('channel-1', {
            allowedMentions: { parse: [] },
            content: '@everyone choose a role',
            embeds: [
                {
                    author: {
                        icon_url: 'https://example.com/author.png',
                        name: 'Roles',
                    },
                    description: null,
                    footer: {
                        icon_url: 'https://example.com/footer.png',
                        text: 'One choice',
                    },
                    image: { url: 'https://example.com/image.png' },
                    thumbnail: { url: 'https://example.com/thumbnail.png' },
                    title: 'Choose',
                },
            ],
            nonce: 'panel-1',
        });
    });
});
