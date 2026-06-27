import { Client, type Client as FluxerClient } from '@fluxerjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyFluxerBotGuildStructureAction, applyFluxerBotGuildStructureUpdate } from './guild-structure-apply.js';

describe('applyFluxerBotGuildStructureAction', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('creates channels with mapped parent ids and returns the created id', async () => {
        const createChannel = vi.fn().mockResolvedValue({ id: 'created-channel-1', guildId: 'guild-1' });
        const login = mockClientLogin({
            guilds: {
                fetch: vi.fn().mockResolvedValue({
                    createChannel,
                }),
            },
        });
        const destroy = vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureAction({
            botToken: ' bot-token ',
            guildId: ' guild-1 ',
            actionType: 'create',
            targetType: 'channel',
            targetId: 'source-channel-1',
            idMap: {
                'source-category-1': 'created-category-1',
            },
            after: {
                id: 'source-channel-1',
                name: ' announcements ',
                type: 0,
                parentId: 'source-category-1',
                permissionOverwrites: [],
            },
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({ createdId: 'created-channel-1' });
        expect(login).toHaveBeenCalledWith('bot-token');
        expect(createChannel).toHaveBeenCalledWith({
            type: 0,
            name: 'announcements',
            parent_id: 'created-category-1',
        });
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('applies mapped permission overwrites after creating channels', async () => {
        const createChannel = vi.fn().mockResolvedValue({ id: 'created-channel-1', guildId: 'guild-1' });
        const editPermission = vi.fn().mockResolvedValue(undefined);

        mockClientLogin({
            guilds: {
                fetch: vi.fn().mockResolvedValue({
                    createChannel,
                }),
            },
            channels: {
                fetch: vi.fn().mockResolvedValue({
                    delete: vi.fn(),
                    editPermission,
                    deletePermission: vi.fn(),
                }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'target-guild-1',
            actionType: 'create',
            targetType: 'channel',
            targetId: 'source-channel-1',
            sourceGuildId: 'source-guild-1',
            idMap: {
                'source-role-1': 'created-role-1',
            },
            after: {
                id: 'source-channel-1',
                name: 'announcements',
                type: 0,
                parentId: null,
                permissionOverwrites: [
                    {
                        id: 'source-role-1',
                        type: 0,
                        allow: '1024',
                        deny: '0',
                    },
                    {
                        id: 'source-guild-1',
                        type: 0,
                        allow: '0',
                        deny: '2048',
                    },
                ],
            },
        });

        expect(result.isOk()).toBe(true);
        expect(editPermission).toHaveBeenCalledTimes(2);
        expect(editPermission).toHaveBeenNthCalledWith(1, 'created-role-1', {
            type: 0,
            allow: '1024',
            deny: '0',
        });
        expect(editPermission).toHaveBeenNthCalledWith(2, 'target-guild-1', {
            type: 0,
            allow: '0',
            deny: '2048',
        });
    });

    it('creates roles with name and permissions', async () => {
        const createRole = vi.fn().mockResolvedValue({ id: 'created-role-1', guildId: 'guild-1' });

        mockClientLogin({
            guilds: {
                fetch: vi.fn().mockResolvedValue({
                    createRole,
                }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'create',
            targetType: 'role',
            targetId: 'source-role-1',
            after: {
                id: 'source-role-1',
                name: 'Member',
                permissions: '1024',
                color: 65280,
                hoist: true,
                mentionable: false,
            },
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({ createdId: 'created-role-1' });
        expect(createRole).toHaveBeenCalledWith({
            name: 'Member',
            permissions: '1024',
            color: 65280,
            hoist: true,
            mentionable: false,
        });
    });

    it('updates role name, permissions, and visual fields', async () => {
        const editRole = vi.fn().mockResolvedValue(undefined);
        const fetchRole = vi.fn().mockResolvedValue({ edit: editRole });

        mockClientLogin({
            guilds: {
                fetch: vi.fn().mockResolvedValue({
                    fetchRole,
                }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'update',
            targetType: 'role',
            targetId: 'role-1',
            changes: [
                { field: 'name', after: 'Member' },
                { field: 'permissions', after: '2048' },
                { field: 'color', after: 255 },
                { field: 'hoist', after: true },
                { field: 'mentionable', after: true },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(fetchRole).toHaveBeenCalledWith('role-1');
        expect(editRole).toHaveBeenCalledWith({
            name: 'Member',
            permissions: '2048',
            color: 255,
            hoist: true,
            mentionable: true,
        });
    });

    it('keeps the update shim compatible with single-field name edits', async () => {
        const edit = vi.fn().mockResolvedValue(undefined);

        mockClientLogin({
            channels: {
                fetch: vi.fn().mockResolvedValue({ edit }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureUpdate({
            botToken: 'bot-token',
            guildId: 'guild-1',
            targetType: 'channel',
            targetId: 'channel-1',
            changes: [{ field: 'name', after: 'announcements' }],
        });

        expect(result.isOk()).toBe(true);
        expect(edit).toHaveBeenCalledWith({
            name: 'announcements',
        });
    });

    it('replaces permission overwrites with delete and edit operations', async () => {
        const editPermission = vi.fn().mockResolvedValue(undefined);
        const deletePermission = vi.fn().mockResolvedValue(undefined);

        mockClientLogin({
            channels: {
                fetch: vi.fn().mockResolvedValue({
                    delete: vi.fn(),
                    editPermission,
                    deletePermission,
                }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'update',
            targetType: 'channel',
            targetId: 'channel-1',
            changes: [
                {
                    field: 'permissionOverwrites',
                    before: [
                        {
                            id: 'role-removed',
                            type: 0,
                            allow: '0',
                            deny: '1024',
                        },
                        {
                            id: 'role-changed',
                            type: 0,
                            allow: '0',
                            deny: '1024',
                        },
                        {
                            id: 'user-unchanged',
                            type: 1,
                            allow: '2048',
                            deny: '0',
                        },
                    ],
                    after: [
                        {
                            id: 'role-changed',
                            type: 0,
                            allow: '1024',
                            deny: '0',
                        },
                        {
                            id: 'user-unchanged',
                            type: 1,
                            allow: '2048',
                            deny: '0',
                        },
                        {
                            id: 'role-added',
                            type: 0,
                            allow: '4096',
                            deny: '0',
                        },
                    ],
                },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(deletePermission).toHaveBeenCalledWith('role-removed');
        expect(editPermission).toHaveBeenCalledTimes(2);
        expect(editPermission).toHaveBeenNthCalledWith(1, 'role-changed', {
            type: 0,
            allow: '1024',
            deny: '0',
        });
        expect(editPermission).toHaveBeenNthCalledWith(2, 'role-added', {
            type: 0,
            allow: '4096',
            deny: '0',
        });
    });

    it('rejects invalid permission overwrite payloads before login', async () => {
        const login = vi.spyOn(Client.prototype, 'login');

        const result = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'create',
            targetType: 'channel',
            targetId: 'source-channel-1',
            after: {
                id: 'source-channel-1',
                name: 'general',
                type: 0,
                permissionOverwrites: [
                    {
                        id: 'role-1',
                        type: 2,
                        allow: '1024',
                        deny: '0',
                    },
                ],
            },
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toMatchObject({
            type: 'invalid-value',
            field: 'permissionOverwrites',
        });
        expect(login).not.toHaveBeenCalled();
    });

    it('deletes channels through the channel platform', async () => {
        const deleteChannel = vi.fn().mockResolvedValue(undefined);

        mockClientLogin({
            channels: {
                fetch: vi.fn().mockResolvedValue({
                    delete: deleteChannel,
                    editPermission: vi.fn(),
                    deletePermission: vi.fn(),
                }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'delete',
            targetType: 'channel',
            targetId: 'channel-1',
        });

        expect(result.isOk()).toBe(true);
        expect(deleteChannel).toHaveBeenCalledOnce();
    });

    it('deletes roles through the role platform', async () => {
        const deleteRole = vi.fn().mockResolvedValue(undefined);
        const fetchRole = vi.fn().mockResolvedValue({ delete: deleteRole });

        mockClientLogin({
            guilds: {
                fetch: vi.fn().mockResolvedValue({
                    fetchRole,
                }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'delete',
            targetType: 'role',
            targetId: 'role-1',
        });

        expect(result.isOk()).toBe(true);
        expect(fetchRole).toHaveBeenCalledWith('role-1');
        expect(deleteRole).toHaveBeenCalledOnce();
    });

    it('rejects unsupported create targets before login', async () => {
        const login = vi.spyOn(Client.prototype, 'login');

        const result = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'create',
            targetType: 'emoji',
            targetId: 'emoji-1',
            after: {
                id: 'emoji-1',
                name: 'party',
            },
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toMatchObject({
            type: 'unsupported-action',
        });
        expect(login).not.toHaveBeenCalled();
    });
});

function mockClientLogin(overrides: Record<string, unknown>) {
    return vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: FluxerClient) {
        for (const [key, value] of Object.entries(overrides)) {
            Object.defineProperty(this, key, {
                configurable: true,
                value,
            });
        }

        return Promise.resolve('session-id');
    });
}
