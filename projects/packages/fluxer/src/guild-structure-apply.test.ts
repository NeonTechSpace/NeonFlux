import { Client, type Client as FluxerClient } from '@fluxerjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    applyFluxerBotGuildStructureAction,
    applyFluxerBotGuildStructureActions,
    applyFluxerBotGuildStructureUpdate,
} from './guild-structure-apply.js';

describe('applyFluxerBotGuildStructureAction', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('creates channels with mapped parent ids and positions', async () => {
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
                position: 2,
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
            position: 2,
        });
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('creates exported link channels by mapping Fluxer read type 998 to create type 5', async () => {
        const createChannel = vi.fn().mockResolvedValue({ id: 'created-link-1', guildId: 'guild-1' });
        mockClientLogin({
            guilds: {
                fetch: vi.fn().mockResolvedValue({
                    createChannel,
                }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'create',
            targetType: 'channel',
            targetId: 'source-link-1',
            after: {
                id: 'source-link-1',
                name: 'Github',
                type: 998,
                url: ' https://github.com/example/project ',
                parentId: null,
                position: 3,
                permissionOverwrites: [],
            },
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({ createdId: 'created-link-1' });
        expect(createChannel).toHaveBeenCalledWith({
            type: 5,
            name: 'Github',
            url: 'https://github.com/example/project',
            parent_id: null,
            position: 3,
        });
    });

    it('rejects protected role create payloads before login', async () => {
        const login = vi.spyOn(Client.prototype, 'login');

        const result = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'create',
            targetType: 'role',
            targetId: 'source-bot-role',
            after: {
                id: 'source-bot-role',
                name: 'Imported Bot',
                position: 10,
                color: 0,
                permissions: '0',
                hoist: true,
                mentionable: false,
                protected: true,
                protectionReason: 'bot',
            },
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'unsupported-action',
            reason: 'Protected bot, integration, and default roles cannot be created.',
        });
        expect(login).not.toHaveBeenCalled();
    });

    it('reuses one client session for a batch of ordered actions', async () => {
        const edit = vi.fn().mockResolvedValue(undefined);
        const login = mockClientLogin({
            channels: {
                fetch: vi.fn().mockResolvedValue({ edit }),
            },
        });
        const destroy = vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureActions({
            botToken: ' bot-token ',
            guildId: ' guild-1 ',
            actions: [
                {
                    id: 'action-1',
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'channel-1',
                    changes: [{ field: 'name', after: 'general' }],
                },
                {
                    id: 'action-2',
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'channel-2',
                    changes: [{ field: 'name', after: 'updates' }],
                },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(login).toHaveBeenCalledExactlyOnceWith('bot-token');
        expect(edit).toHaveBeenCalledTimes(2);
        expect(destroy).toHaveBeenCalledOnce();
        expect(result._unsafeUnwrap().actions).toStrictEqual([
            { id: 'action-1', status: 'applied' },
            { id: 'action-2', status: 'applied' },
        ]);
    });

    it('applies channel parent and position updates', async () => {
        const edit = vi.fn().mockResolvedValue(undefined);
        const setChannelPositions = vi.fn().mockResolvedValue(undefined);
        mockClientLogin({
            guilds: {
                fetch: vi.fn().mockResolvedValue({
                    setChannelPositions,
                    setRolePositions: vi.fn(),
                }),
            },
            channels: {
                fetch: vi.fn().mockResolvedValue({ edit }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'update',
            targetType: 'channel',
            targetId: 'channel-1',
            idMap: {
                'source-category-1': 'category-1',
            },
            changes: [
                { field: 'parentId', before: null, after: 'source-category-1' },
                { field: 'position', before: 0, after: 4 },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(edit).not.toHaveBeenCalled();
        expect(setChannelPositions).toHaveBeenCalledWith([{ id: 'channel-1', parent_id: 'category-1', position: 4 }]);
    });

    it('applies role position updates except for @everyone', async () => {
        const setRolePositions = vi.fn().mockResolvedValue([]);
        mockClientLogin({
            guilds: {
                fetch: vi.fn().mockResolvedValue({
                    fetchRole: vi.fn(),
                    setChannelPositions: vi.fn(),
                    setRolePositions,
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
            changes: [{ field: 'position', before: 1, after: 5 }],
        });
        const everyoneResult = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'update',
            targetType: 'role',
            targetId: 'guild-1',
            changes: [{ field: 'position', before: 0, after: 1 }],
        });

        expect(result.isOk()).toBe(true);
        expect(setRolePositions).toHaveBeenCalledWith([{ id: 'role-1', position: 5 }]);
        expect(everyoneResult.isErr()).toBe(true);
        expect(everyoneResult._unsafeUnwrapErr()).toStrictEqual({
            type: 'unsupported-action',
            reason: 'Protected default roles cannot be updated.',
        });
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

    it('records partial channel create failures with the created id and source map', async () => {
        const createChannel = vi.fn().mockResolvedValue({ id: 'created-channel-1', guildId: 'guild-1' });
        const editPermission = vi.fn().mockRejectedValue({ status: 403 });

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

        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'target-guild-1',
            actions: [
                {
                    id: 'action-create-channel',
                    actionType: 'create',
                    targetType: 'channel',
                    targetId: 'source-channel-1',
                    after: {
                        id: 'source-channel-1',
                        name: 'announcements',
                        type: 0,
                        parentId: null,
                        permissionOverwrites: [
                            {
                                id: 'target-guild-1',
                                type: 0,
                                allow: '0',
                                deny: '2048',
                            },
                        ],
                    },
                },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            actions: [
                {
                    id: 'action-create-channel',
                    status: 'failed',
                    createdId: 'created-channel-1',
                    errorType: 'partial-create-failed',
                    errorCauseType: 'permission-denied',
                },
            ],
            idMap: {
                'source-channel-1': 'created-channel-1',
            },
        });
    });

    it('repairs mapped retry creates instead of creating duplicate channels', async () => {
        const createChannel = vi.fn();
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

        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'target-guild-1',
            idMap: {
                'source-channel-1': 'created-channel-1',
            },
            actions: [
                {
                    id: 'retry-create-channel',
                    actionType: 'create',
                    targetType: 'channel',
                    targetId: 'source-channel-1',
                    after: {
                        id: 'source-channel-1',
                        name: 'announcements',
                        type: 0,
                        parentId: null,
                        permissionOverwrites: [
                            {
                                id: 'target-guild-1',
                                type: 0,
                                allow: '0',
                                deny: '2048',
                            },
                        ],
                    },
                },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(createChannel).not.toHaveBeenCalled();
        expect(editPermission).toHaveBeenCalledWith('target-guild-1', {
            type: 0,
            allow: '0',
            deny: '2048',
        });
        expect(result._unsafeUnwrap()).toStrictEqual({
            actions: [{ id: 'retry-create-channel', status: 'applied' }],
            idMap: {
                'source-channel-1': 'created-channel-1',
            },
        });
    });

    it('creates roles with name, permissions, and position', async () => {
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
                position: 3,
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
            position: 3,
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
