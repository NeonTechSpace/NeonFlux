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

    it('resolves only the focused guild channel metadata needed before dashboard posting', async () => {
        const resolve = vi.fn().mockResolvedValue({
            guildId: 'guild-1',
            id: 'channel-1',
            name: 'general',
            type: 0,
            permissionOverwrites: [{ id: 'secret-role-data' }],
        });
        const platform = createFluxerPlatform(createClient({ channels: { resolve } }));

        const result = await platform.messages.resolveDashboardTarget({ channelId: ' channel-1 ' });

        expect(result._unsafeUnwrap()).toStrictEqual({
            guildId: 'guild-1',
            id: 'channel-1',
            name: 'general',
            type: 0,
        });
        expect(resolve).toHaveBeenCalledWith('channel-1');
    });

    it('rejects non-guild posting targets', async () => {
        const platform = createFluxerPlatform(
            createClient({
                channels: {
                    resolve: vi.fn().mockResolvedValue({ guildId: null, id: 'dm-1', name: null, type: 1 }),
                },
            })
        );

        const result = await platform.messages.resolveDashboardTarget({ channelId: 'dm-1' });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('rejects a channel resolver response for a different id', async () => {
        const platform = createFluxerPlatform(
            createClient({
                channels: {
                    resolve: vi.fn().mockResolvedValue({
                        guildId: 'guild-1',
                        id: 'channel-2',
                        name: 'other',
                        type: 0,
                    }),
                },
            })
        );

        const result = await platform.messages.resolveDashboardTarget({ channelId: 'channel-1' });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('fetches recent messages without exposing SDK collections', async () => {
        const fetch = vi.fn<(options: { limit: number; before?: string }) => Promise<Map<string, Message>>>();
        fetch.mockResolvedValue(
            new Map([
                ['message-2', createMessage({ id: 'message-2' })],
                ['message-1', createMessage({ id: 'message-1' })],
            ])
        );
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

        const result = await platform.messages.fetchMany({
            channelId: ' channel-1 ',
            limit: 2,
            before: ' message-3 ',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual([
            {
                id: 'message-2',
                channelId: 'channel-1',
                guildId: 'guild-1',
            },
            {
                id: 'message-1',
                channelId: 'channel-1',
                guildId: 'guild-1',
            },
        ]);
        expect(fetch).toHaveBeenCalledWith({
            limit: 2,
            before: 'message-3',
        });
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

    it('rejects invalid recent-message limits before resolving the channel', async () => {
        const resolve = vi.fn();
        const platform = createFluxerPlatform(
            createClient({
                channels: {
                    resolve,
                },
            })
        );

        const result = await platform.messages.fetchMany({
            channelId: 'channel-1',
            limit: 0,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'limit',
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

    it('keeps explicit empty embed arrays so full-state edits clear stale embeds', async () => {
        const edit = vi.fn().mockResolvedValue({ id: 'message-1', channelId: 'channel-1', guildId: 'guild-1' });
        const fetch = vi.fn().mockResolvedValue({
            id: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            edit,
        });
        const platform = createFluxerPlatform(
            createClient({
                channels: {
                    resolve: vi.fn().mockResolvedValue({ messages: { fetch } }),
                },
            })
        );

        const result = await platform.messages.edit({
            channelId: 'channel-1',
            messageId: 'message-1',
            content: 'Plain text only',
            embeds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(edit).toHaveBeenCalledWith({ content: 'Plain text only', embeds: [] });
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

    it('passes v2 camelCase ban options through the moderation port', async () => {
        const ban = vi.fn().mockResolvedValue(undefined);
        const platform = createFluxerPlatform(createClient({ guilds: { fetch: vi.fn().mockResolvedValue({ ban }) } }));

        const result = await platform.moderation.ban({
            guildId: ' guild-1 ',
            userId: ' user-1 ',
            reason: ' cleanup ',
            deleteMessageDays: 2,
        });

        expect(result.isOk()).toBe(true);
        expect(ban).toHaveBeenCalledWith('user-1', { reason: 'cleanup', deleteMessageDays: 2 });
    });

    it('times out members through the normalized moderation port', async () => {
        const edit = vi.fn().mockResolvedValue(undefined);
        const fetchMember = vi.fn().mockResolvedValue({
            edit,
        });
        const platform = createFluxerPlatform(
            createClient({
                guilds: {
                    fetch: vi.fn().mockResolvedValue({
                        fetchMember,
                    }),
                },
            })
        );
        const expiresAt = new Date('2026-06-26T12:30:00.000Z');

        const result = await platform.moderation.timeout({
            guildId: ' guild-1 ',
            userId: ' user-1 ',
            expiresAt,
            reason: ' slow down ',
        });

        expect(result.isOk()).toBe(true);
        expect(fetchMember).toHaveBeenCalledWith('user-1');
        expect(edit).toHaveBeenCalledWith({
            communicationDisabledUntil: '2026-06-26T12:30:00.000Z',
            timeoutReason: 'slow down',
        });
    });

    it('removes member timeouts through the normalized moderation port', async () => {
        const edit = vi.fn().mockResolvedValue(undefined);
        const platform = createFluxerPlatform(
            createClient({
                guilds: {
                    fetch: vi.fn().mockResolvedValue({
                        fetchMember: vi.fn().mockResolvedValue({
                            edit,
                        }),
                    }),
                },
            })
        );

        const result = await platform.moderation.untimeout({
            guildId: 'guild-1',
            userId: 'user-1',
            reason: 'served',
        });

        expect(result.isOk()).toBe(true);
        expect(edit).toHaveBeenCalledWith({
            communicationDisabledUntil: null,
            timeoutReason: 'served',
        });
    });

    it('rejects invalid timeout expiry before fetching the guild', async () => {
        const fetch = vi.fn();
        const platform = createFluxerPlatform(
            createClient({
                guilds: {
                    fetch,
                },
            })
        );

        const result = await platform.moderation.timeout({
            guildId: 'guild-1',
            userId: 'user-1',
            expiresAt: new Date(Number.NaN),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'expiresAt',
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

    it('edits role name, position, and visual fields through the normalized roles port', async () => {
        const patchRole = vi.fn().mockResolvedValue(undefined);
        const fetchGuild = vi.fn();
        const setRolePositions = vi.fn().mockResolvedValue([]);
        fetchGuild.mockResolvedValue({ setRolePositions });
        const platform = createFluxerPlatform(
            createClient({
                guilds: {
                    fetch: fetchGuild,
                },
                rest: { patch: patchRole },
            })
        );

        const result = await platform.roles.edit({
            guildId: ' guild-1 ',
            roleId: ' role-1 ',
            name: ' Member ',
            permissions: ' 2048 ',
            position: 5,
            color: 255,
            hoist: true,
            mentionable: false,
        });

        expect(result.isOk()).toBe(true);
        expect(patchRole).toHaveBeenCalledWith('/guilds/guild-1/roles/role-1', {
            auth: true,
            body: {
                name: 'Member',
                permissions: '2048',
                color: 255,
                hoist: true,
                mentionable: false,
            },
        });
        expect(fetchGuild).toHaveBeenCalledTimes(1);
        expect(setRolePositions).toHaveBeenCalledWith([{ id: 'role-1', position: 5 }]);
    });

    it('edits a role directly without fetching the guild or a single role', async () => {
        const patchRole = vi.fn().mockResolvedValue(undefined);
        const fetchGuild = vi.fn();
        const platform = createFluxerPlatform(
            createClient({
                guilds: { fetch: fetchGuild },
                rest: { patch: patchRole },
            })
        );

        const result = await platform.roles.edit({
            guildId: 'guild-1',
            roleId: 'role-1',
            hoist: false,
        });

        expect(result.isOk()).toBe(true);
        expect(patchRole).toHaveBeenCalledWith('/guilds/guild-1/roles/role-1', {
            auth: true,
            body: { hoist: false },
        });
        expect(fetchGuild).not.toHaveBeenCalled();
    });

    it.each([
        [403, 'permission-denied'],
        [404, 'not-found'],
    ] as const)('maps role edit API status %i to %s', async (statusCode, expectedType) => {
        const platform = createFluxerPlatform(
            createClient({
                guilds: { fetch: vi.fn() },
                rest: { patch: vi.fn().mockRejectedValue({ statusCode }) },
            })
        );

        const result = await platform.roles.edit({
            guildId: 'guild-1',
            roleId: 'role-1',
            name: 'Member',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: expectedType });
    });

    it('rejects empty role edits before using REST or fetching the guild', async () => {
        const patchRole = vi.fn();
        const fetchGuild = vi.fn();
        const platform = createFluxerPlatform(
            createClient({
                guilds: { fetch: fetchGuild },
                rest: { patch: patchRole },
            })
        );

        const result = await platform.roles.edit({ guildId: 'guild-1', roleId: 'role-1' });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'role' });
        expect(patchRole).not.toHaveBeenCalled();
        expect(fetchGuild).not.toHaveBeenCalled();
    });

    it('rejects @everyone role moves before fetching the guild', async () => {
        const fetch = vi.fn();
        const platform = createFluxerPlatform(
            createClient({
                guilds: {
                    fetch,
                },
            })
        );

        const result = await platform.roles.edit({
            guildId: 'guild-1',
            roleId: 'guild-1',
            position: 1,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'position',
        } satisfies FluxerPlatformError);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects invalid role colors before fetching the guild', async () => {
        const fetch = vi.fn();
        const platform = createFluxerPlatform(
            createClient({
                guilds: {
                    fetch,
                },
            })
        );

        const result = await platform.roles.edit({
            guildId: 'guild-1',
            roleId: 'role-1',
            color: 0x1000000,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'color',
        } satisfies FluxerPlatformError);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('edits channel name, parent, position, and voice user limit through the normalized channels port', async () => {
        const edit = vi.fn().mockResolvedValue(undefined);
        const setChannelPositions = vi.fn().mockResolvedValue(undefined);
        const platform = createFluxerPlatform(
            createClient({
                guilds: {
                    fetch: vi.fn().mockResolvedValue({
                        setChannelPositions,
                    }),
                },
                channels: {
                    fetch: vi.fn().mockResolvedValue({ edit }),
                },
            })
        );

        const result = await platform.channels.edit({
            channelId: ' channel-1 ',
            guildId: ' guild-1 ',
            name: ' New Room ',
            parentId: ' category-1 ',
            position: 3,
            userLimit: 4,
        });

        expect(result.isOk()).toBe(true);
        expect(edit).toHaveBeenCalledWith({
            name: 'New Room',
            userLimit: 4,
        });
        expect(setChannelPositions).toHaveBeenCalledWith([{ id: 'channel-1', parentId: 'category-1', position: 3 }]);
    });

    it('rejects invalid channel edit payloads before fetching the channel', async () => {
        const fetch = vi.fn();
        const platform = createFluxerPlatform(
            createClient({
                channels: {
                    fetch,
                },
            })
        );

        const result = await platform.channels.edit({
            channelId: 'channel-1',
            userLimit: 100,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'userLimit',
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

        const result = await platform.members.read({
            guildId: 'guild-1',
            userId: 'user-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'not-found',
        } satisfies FluxerPlatformError);
    });

    it('deletes roles through the documented REST endpoint without a single-role lookup', async () => {
        const deleteRole = vi.fn().mockResolvedValue(undefined);
        const fetchGuild = vi.fn();
        const platform = createFluxerPlatform(
            createClient({
                guilds: { fetch: fetchGuild },
                rest: { delete: deleteRole },
            })
        );

        const result = await platform.roles.delete({
            guildId: ' guild-1 ',
            roleId: ' role-1 ',
        });

        expect(result.isOk()).toBe(true);
        expect(deleteRole).toHaveBeenCalledWith('/guilds/guild-1/roles/role-1', { auth: true });
        expect(fetchGuild).not.toHaveBeenCalled();
    });

    it.each([
        [403, 'permission-denied'],
        [404, 'not-found'],
    ] as const)('maps nested SDK status %i to %s', async (statusCode, expectedType) => {
        const wrappedError = new Error('SDK operation failed', {
            cause: { statusCode },
        });
        const platform = createFluxerPlatform(
            createClient({
                rest: {
                    delete: vi.fn().mockRejectedValue(wrappedError),
                },
            })
        );

        const result = await platform.roles.delete({
            guildId: 'guild-1',
            roleId: 'role-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: expectedType });
    });

    it('reads member role IDs without exposing SDK member objects', async () => {
        const fetchMember = vi.fn().mockResolvedValue({
            roles: {
                roleIds: ['role-1', 'role-2'],
            },
        });
        const platform = createFluxerPlatform(
            createClient({
                guilds: {
                    fetch: vi.fn().mockResolvedValue({
                        fetchMember,
                    }),
                },
            })
        );

        const result = await platform.members.read({
            guildId: ' guild-1 ',
            userId: ' user-1 ',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: ['role-1', 'role-2'],
        });
        expect(fetchMember).toHaveBeenCalledWith('user-1');
    });

    it('rejects invalid member role responses', async () => {
        const platform = createFluxerPlatform(
            createClient({
                guilds: {
                    fetch: vi.fn().mockResolvedValue({
                        fetchMember: vi.fn().mockResolvedValue({
                            roles: {
                                roleIds: [123],
                            },
                        }),
                    }),
                },
            })
        );

        const result = await platform.members.read({
            guildId: 'guild-1',
            userId: 'user-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toMatchObject({
            type: 'operation-failed',
        } satisfies Partial<FluxerPlatformError>);
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

    it('uses the v2 bulkDelete channel method', async () => {
        const bulkDelete = vi.fn().mockResolvedValue(['message-1']);
        const platform = createFluxerPlatform(
            createClient({ channels: { fetch: vi.fn().mockResolvedValue({ bulkDelete }) } })
        );

        const result = await platform.messages.bulkDelete({
            channelId: ' channel-1 ',
            messageIds: [' message-1 '],
        });

        expect(result.isOk()).toBe(true);
        expect(bulkDelete).toHaveBeenCalledWith(['message-1']);
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
