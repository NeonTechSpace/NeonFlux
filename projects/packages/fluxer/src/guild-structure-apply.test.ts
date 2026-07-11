import { Client, type Client as FluxerClient } from '@fluxerjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    applyFluxerBotGuildStructureAction,
    applyFluxerBotGuildStructureActions,
    applyFluxerBotGuildStructureUpdate,
} from './guild-structure-apply.js';

describe('applyFluxerBotGuildStructureAction', () => {
    afterEach(() => {
        vi.useRealTimers();
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

    it('creates exported link channels with Fluxer wire type 998', async () => {
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
            type: 998,
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
        const error = result._unsafeUnwrapErr();
        expect(error.type).toBe('unsupported-action');

        if (error.type !== 'unsupported-action') {
            throw new Error(`Expected unsupported-action, got ${error.type}`);
        }

        expect(error.reason).toMatch(/protected/iu);
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
            operationDelayMs: 0,
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

    it('reports provider retry timing and invokes the result callback for rate limits', async () => {
        const edit = vi.fn().mockRejectedValue({ status: 429, retry_after: 2.5 });
        mockClientLogin({ channels: { fetch: vi.fn().mockResolvedValue({ edit }) } });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);
        const onActionResult = vi.fn().mockResolvedValue(true);

        const result = await applyFluxerBotGuildStructureActions({
            actions: [
                {
                    id: 'action-1',
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'channel-1',
                    changes: [{ field: 'name', after: 'general' }],
                },
            ],
            botToken: 'bot-token',
            guildId: 'guild-1',
            onActionResult,
            operationDelayMs: 0,
        });

        expect(result._unsafeUnwrap().actions).toStrictEqual([
            { id: 'action-1', status: 'failed', errorType: 'rate-limited', retryAfterMs: 2_500 },
        ]);
        expect(onActionResult).toHaveBeenCalledWith(
            { id: 'action-1', status: 'failed', errorType: 'rate-limited', retryAfterMs: 2_500 },
            {}
        );
    });

    it('invokes the result callback for normalization failures', async () => {
        mockClientLogin({});
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);
        const onActionResult = vi.fn().mockResolvedValue(true);

        const result = await applyFluxerBotGuildStructureActions({
            actions: [{ id: 'action-1', actionType: 'update', targetType: 'channel' }],
            botToken: 'bot-token',
            guildId: 'guild-1',
            onActionResult,
            operationDelayMs: 0,
        });

        expect(result._unsafeUnwrap().actions).toStrictEqual([
            { id: 'action-1', status: 'failed', errorType: 'missing-input' },
        ]);
        expect(onActionResult).toHaveBeenCalledOnce();
    });

    it('paces batch mutations between operations by default', async () => {
        const expectedDefaultDelayMs = 750;
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-09T00:00:00.000Z'));

        const editTimes: number[] = [];
        const edit = vi.fn().mockImplementation(() => {
            editTimes.push(Date.now());
            return Promise.resolve(undefined);
        });

        mockClientLogin({
            channels: {
                fetch: vi.fn().mockResolvedValue({ edit }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const resultPromise = applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'guild-1',
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
                {
                    id: 'action-3',
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'channel-3',
                    changes: [{ field: 'name', after: 'news' }],
                },
            ],
        });

        await vi.advanceTimersByTimeAsync(expectedDefaultDelayMs * 2);

        const result = await resultPromise;

        expect(result.isOk()).toBe(true);
        expect(editTimes).toStrictEqual([
            new Date('2026-07-09T00:00:00.000Z').getTime(),
            new Date('2026-07-09T00:00:00.000Z').getTime() + expectedDefaultDelayMs,
            new Date('2026-07-09T00:00:00.000Z').getTime() + expectedDefaultDelayMs * 2,
        ]);
    });

    it('does not start creates after rebuild delete failures when requested', async () => {
        const deleteChannel = vi.fn().mockRejectedValue({ status: 403 });
        const createRole = vi.fn().mockResolvedValue({ id: 'created-role-1', guildId: 'guild-1' });

        mockClientLogin({
            channels: {
                fetch: vi.fn().mockResolvedValue({
                    delete: deleteChannel,
                    editPermission: vi.fn(),
                    deletePermission: vi.fn(),
                }),
            },
            guilds: {
                fetch: vi.fn().mockResolvedValue({
                    createRole,
                }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'guild-1',
            operationDelayMs: 0,
            stopAfterDeleteFailures: true,
            actions: [
                {
                    id: 'action-delete-channel',
                    actionType: 'delete',
                    targetType: 'channel',
                    targetId: 'channel-1',
                },
                {
                    id: 'action-create-role',
                    actionType: 'create',
                    targetType: 'role',
                    targetId: 'source-role-1',
                    after: {
                        id: 'source-role-1',
                        name: 'Member',
                        permissions: '0',
                        position: 1,
                        color: 0,
                        hoist: false,
                        mentionable: false,
                    },
                },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(createRole).not.toHaveBeenCalled();
        expect(result._unsafeUnwrap()).toStrictEqual({
            actions: [
                { id: 'action-delete-channel', status: 'failed', errorType: 'permission-denied' },
                { id: 'action-create-role', status: 'failed', errorType: 'rebuild-delete-failed' },
            ],
            idMap: {},
        });
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
        const everyoneError = everyoneResult._unsafeUnwrapErr();
        expect(everyoneError.type).toBe('unsupported-action');

        if (everyoneError.type !== 'unsupported-action') {
            throw new Error(`Expected unsupported-action, got ${everyoneError.type}`);
        }

        expect(everyoneError.reason).toMatch(/protected/iu);
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
            operationDelayMs: 0,
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
            operationDelayMs: 0,
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

    it('reuses mapped retry roles instead of creating duplicates', async () => {
        mockClientLogin({});
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'target-guild-1',
            operationDelayMs: 0,
            idMap: {
                'source-role-1': 'created-role-1',
            },
            actions: [
                {
                    id: 'retry-create-role',
                    actionType: 'create',
                    targetType: 'role',
                    targetId: 'source-role-1',
                    after: {
                        id: 'source-role-1',
                        name: 'Member',
                        permissions: '1024',
                        position: 3,
                        color: 0,
                        hoist: false,
                        mentionable: false,
                    },
                },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            actions: [{ id: 'retry-create-role', status: 'applied', createdId: 'created-role-1' }],
            idMap: {
                'source-role-1': 'created-role-1',
            },
        });
    });

    it('creates roles with name, permissions, and visuals without applying source positions', async () => {
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
            color: 65280,
            hoist: true,
            mentionable: false,
        });
    });

    it('creates roles first and then applies requested role order with mapped target ids', async () => {
        const createRole = vi
            .fn()
            .mockResolvedValueOnce({ id: 'created-role-top', guildId: 'guild-1' })
            .mockResolvedValueOnce({ id: 'created-role-low', guildId: 'guild-1' });
        const setRolePositions = vi.fn().mockResolvedValue([]);

        mockClientLogin({
            guilds: {
                fetch: vi.fn().mockResolvedValue({
                    createRole,
                    setRolePositions,
                }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'guild-1',
            operationDelayMs: 0,
            actions: [
                {
                    id: 'action-create-top-role',
                    actionType: 'create',
                    targetType: 'role',
                    targetId: 'source-role-top',
                    after: {
                        id: 'source-role-top',
                        name: 'Top Role',
                        permissions: '0',
                        position: 8,
                        hierarchyRank: 0,
                        color: 0,
                        hoist: false,
                        mentionable: false,
                    },
                },
                {
                    id: 'action-create-low-role',
                    actionType: 'create',
                    targetType: 'role',
                    targetId: 'source-role-low',
                    after: {
                        id: 'source-role-low',
                        name: 'Low Role',
                        permissions: '0',
                        position: 3,
                        hierarchyRank: 1,
                        color: 0,
                        hoist: false,
                        mentionable: false,
                    },
                },
            ],
            roleOrder: [
                { sourceId: 'source-role-low', position: 3, hierarchyRank: 1 },
                { sourceId: 'source-role-top', position: 8, hierarchyRank: 0 },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(createRole).toHaveBeenNthCalledWith(1, {
            name: 'Top Role',
            permissions: '0',
            color: 0,
            hoist: false,
            mentionable: false,
        });
        expect(setRolePositions).toHaveBeenCalledWith([
            { id: 'created-role-top', position: 8 },
            { id: 'created-role-low', position: 3 },
        ]);
        expect(result._unsafeUnwrap()).toStrictEqual({
            actions: [
                { id: 'action-create-top-role', status: 'applied', createdId: 'created-role-top' },
                { id: 'action-create-low-role', status: 'applied', createdId: 'created-role-low' },
            ],
            idMap: {
                'source-role-top': 'created-role-top',
                'source-role-low': 'created-role-low',
            },
            roleOrder: { status: 'applied' },
        });
    });

    it('reconciles the complete channel hierarchy after applying structural actions', async () => {
        const setChannelPositions = vi.fn().mockResolvedValue(undefined);
        mockClientLogin({
            guilds: {
                fetch: vi.fn().mockResolvedValue({ setChannelPositions }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'guild-1',
            operationDelayMs: 0,
            actions: [],
            idMap: {
                'source-category-a': 'target-category-a',
                'source-category-b': 'target-category-b',
                'source-channel-a-1': 'target-channel-a-1',
                'source-channel-a-2': 'target-channel-a-2',
                'source-channel-b': 'target-channel-b',
            },
            channelOrder: [
                { sourceId: 'source-category-b', parentSourceId: null, position: 20 },
                { sourceId: 'source-channel-b', parentSourceId: 'source-category-b', position: 21 },
                { sourceId: 'source-channel-a-2', parentSourceId: 'source-category-a', position: 3 },
                { sourceId: 'source-category-a', parentSourceId: null, position: 1 },
                { sourceId: 'source-channel-a-1', parentSourceId: 'source-category-a', position: 2 },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(setChannelPositions).toHaveBeenCalledWith([
            { id: 'target-category-a', parent_id: null, position: 0 },
            { id: 'target-category-b', parent_id: null, position: 1 },
            { id: 'target-channel-a-1', parent_id: 'target-category-a', position: 0 },
            { id: 'target-channel-a-2', parent_id: 'target-category-a', position: 1 },
            { id: 'target-channel-b', parent_id: 'target-category-b', position: 0 },
        ]);
        expect(result._unsafeUnwrap()).toMatchObject({ channelOrder: { status: 'applied' } });
    });

    it('fails synthetic ordering before mutation when a source id is not mapped', async () => {
        const setChannelPositions = vi.fn().mockResolvedValue(undefined);
        const setRolePositions = vi.fn().mockResolvedValue(undefined);
        mockClientLogin({
            guilds: {
                fetch: vi.fn().mockResolvedValue({ setChannelPositions, setRolePositions }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'target-guild',
            operationDelayMs: 0,
            actions: [],
            idMap: {
                'source-category': 'target-category',
                'source-role': 'target-role',
            },
            channelOrder: [
                { sourceId: 'source-category', parentSourceId: null, position: 0 },
                { sourceId: 'source-channel-missing', parentSourceId: 'source-category', position: 1 },
            ],
            roleOrder: [
                { sourceId: 'source-role', position: 2 },
                { sourceId: 'source-role-missing', position: 1 },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({
            channelOrder: { status: 'failed', errorType: 'structure-order-mapping-missing' },
            roleOrder: { status: 'failed', errorType: 'structure-order-mapping-missing' },
        });
        expect(setChannelPositions).not.toHaveBeenCalled();
        expect(setRolePositions).not.toHaveBeenCalled();
    });

    it('rejects malformed or ambiguous synthetic order plans before mutation', async () => {
        const setChannelPositions = vi.fn().mockResolvedValue(undefined);
        const setRolePositions = vi.fn().mockResolvedValue(undefined);
        mockClientLogin({
            guilds: {
                fetch: vi.fn().mockResolvedValue({ setChannelPositions, setRolePositions }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'target-guild',
            operationDelayMs: 0,
            actions: [],
            idMap: {
                'source-channel-a': 'target-channel',
                'source-channel-b': 'target-channel',
                'source-role': 'target-role',
            },
            channelOrder: [
                { sourceId: 'source-channel-a', parentSourceId: null, position: 0 },
                { sourceId: 'source-channel-b', parentSourceId: null, position: 1 },
            ],
            roleOrder: [
                { sourceId: 'source-role', position: 2 },
                { sourceId: ' ', position: 1 },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({
            channelOrder: { status: 'failed', errorType: 'structure-order-plan-invalid' },
            roleOrder: { status: 'failed', errorType: 'structure-order-plan-invalid' },
        });
        expect(setChannelPositions).not.toHaveBeenCalled();
        expect(setRolePositions).not.toHaveBeenCalled();
    });

    it('stops external mutations immediately when the apply lease is lost', async () => {
        const edit = vi.fn().mockResolvedValue(undefined);
        mockClientLogin({
            channels: {
                fetch: vi.fn().mockResolvedValue({ edit }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);
        const beforeMutation = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);

        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'guild-1',
            operationDelayMs: 0,
            beforeMutation,
            actions: [
                {
                    id: 'action-first',
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'channel-1',
                    changes: [{ field: 'name', after: 'first' }],
                },
                {
                    id: 'action-second',
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'channel-2',
                    changes: [{ field: 'name', after: 'second' }],
                },
            ],
        });

        expect(result._unsafeUnwrap()).toStrictEqual({
            actions: [
                { id: 'action-first', status: 'applied' },
                { id: 'action-second', status: 'failed', errorType: 'apply-lease-lost' },
            ],
            idMap: {},
        });
        expect(edit).toHaveBeenCalledOnce();
        expect(beforeMutation).toHaveBeenCalledTimes(2);
    });

    it('rechecks the apply lease between mutations inside one compound action', async () => {
        const editPermission = vi.fn().mockResolvedValue(undefined);
        mockClientLogin({
            channels: {
                fetch: vi.fn().mockResolvedValue({
                    delete: vi.fn(),
                    deletePermission: vi.fn(),
                    editPermission,
                }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);
        const beforeMutation = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);

        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'guild-1',
            operationDelayMs: 0,
            beforeMutation,
            actions: [
                {
                    id: 'action-overwrites',
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'channel-1',
                    changes: [
                        {
                            field: 'permissionOverwrites',
                            before: [],
                            after: [
                                { id: 'role-1', type: 0, allow: '1', deny: '0' },
                                { id: 'role-2', type: 0, allow: '2', deny: '0' },
                            ],
                        },
                    ],
                },
            ],
        });

        expect(result._unsafeUnwrap()).toStrictEqual({
            actions: [{ id: 'action-overwrites', status: 'failed', errorType: 'apply-lease-lost' }],
            idMap: {},
        });
        expect(editPermission).toHaveBeenCalledExactlyOnceWith('role-1', {
            type: 0,
            allow: '1',
            deny: '0',
        });
    });

    it('updates role name, permissions, and visual fields', async () => {
        const patchRole = vi.fn().mockResolvedValue(undefined);

        mockClientLogin({
            rest: { patch: patchRole },
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
        expect(patchRole).toHaveBeenCalledWith('/guilds/guild-1/roles/role-1', {
            auth: true,
            body: {
                name: 'Member',
                permissions: '2048',
                color: 255,
                hoist: true,
                mentionable: true,
            },
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

        mockClientLogin({
            rest: {
                delete: deleteRole,
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
        expect(deleteRole).toHaveBeenCalledWith('/guilds/guild-1/roles/role-1', { auth: true });
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
