import { Client, type Client as FluxerClient } from '@fluxerjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    applyFluxerBotGuildStructureAction,
    applyFluxerBotGuildStructureActions,
    applyFluxerBotGuildStructureUpdate,
} from './guild-structure-apply.js';
import {
    createFluxerGuildStructureRestClient,
    GUILD_STRUCTURE_REST_TIMEOUT_MS,
} from './guild-structure-rest-client.js';

describe('applyFluxerBotGuildStructureAction', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('constructs Blueprint clients with bounded REST and automatic retries disabled', async () => {
        const login = vi.spyOn(Client.prototype, 'login');
        const client = createFluxerGuildStructureRestClient('bot-token');

        expect(client.options.rest).toMatchObject({ retries: 0, timeout: GUILD_STRUCTURE_REST_TIMEOUT_MS });
        expect(client.rest.token).toBe('bot-token');
        expect(login).not.toHaveBeenCalled();
        await client.destroy();
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
        expect(login).not.toHaveBeenCalled();
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
            knownTargetKinds: { 'guild-1': 'role', 'channel-1': 'channel', 'channel-2': 'channel' },
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
        expect(login).not.toHaveBeenCalled();
        expect(edit).toHaveBeenCalledTimes(2);
        expect(destroy).toHaveBeenCalledOnce();
        expect(result._unsafeUnwrap().actions).toStrictEqual([
            { id: 'action-1', status: 'applied' },
            { id: 'action-2', status: 'applied' },
        ]);
    });

    it('rejects an invalid later reference before login or an earlier mutation', async () => {
        const login = vi.spyOn(Client.prototype, 'login');

        const result = await applyFluxerBotGuildStructureActions({
            actions: [
                {
                    id: 'update-role',
                    actionType: 'update',
                    targetType: 'role',
                    targetId: 'target-role',
                    changes: [{ field: 'name', after: 'Verified' }],
                },
                {
                    id: 'channel-order',
                    actionType: 'update',
                    targetType: 'channel-order',
                    after: [{ sourceId: 'unmapped-source-channel', parentSourceId: null, position: 0 }],
                },
            ],
            botToken: 'bot-token',
            guildId: 'target-guild',
            knownTargetKinds: { 'target-guild': 'role', 'target-role': 'role' },
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'structure-order-mapping-missing',
            actionId: 'channel-order',
        });
        expect(login).not.toHaveBeenCalled();
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
            knownTargetKinds: { 'guild-1': 'role', 'channel-1': 'channel' },
            onActionResult,
            operationDelayMs: 0,
        });

        expect(result._unsafeUnwrap().actions).toStrictEqual([
            {
                id: 'action-1',
                status: 'failed',
                errorType: 'rate-limited',
                mutationOutcome: 'not-applied',
                retryAfterMs: 2_500,
            },
        ]);
        expect(onActionResult).toHaveBeenCalledWith(
            {
                id: 'action-1',
                status: 'failed',
                errorType: 'rate-limited',
                mutationOutcome: 'not-applied',
                retryAfterMs: 2_500,
            },
            {}
        );
    });

    it('reports a transport abort as unknown without replaying the mutation', async () => {
        const transportAbort = new Error('The operation was aborted');
        transportAbort.name = 'AbortError';
        const edit = vi.fn().mockRejectedValue(transportAbort);
        const login = mockClientLogin({ channels: { fetch: vi.fn().mockResolvedValue({ edit }) } });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);
        const beforeMutation = vi.fn().mockResolvedValue(true);

        const result = await applyFluxerBotGuildStructureActions({
            actions: [
                {
                    id: 'rename-channel',
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'channel-1',
                    changes: [{ field: 'name', after: 'renamed' }],
                },
            ],
            beforeMutation,
            botToken: 'bot-token',
            guildId: 'guild-1',
            knownTargetKinds: { 'channel-1': 'channel', 'guild-1': 'role' },
            operationDelayMs: 0,
        });

        expect(result._unsafeUnwrap().actions).toStrictEqual([
            {
                errorType: 'operation-failed',
                id: 'rename-channel',
                mutationOutcome: 'unknown',
                status: 'failed',
            },
        ]);
        expect(beforeMutation).toHaveBeenCalledOnce();
        expect(edit).toHaveBeenCalledOnce();
        expect(login).not.toHaveBeenCalled();
    });

    it('distinguishes definite client rejection from ambiguous timeout and server responses', async () => {
        const edit = vi
            .fn()
            .mockRejectedValueOnce({ status: 400 })
            .mockRejectedValueOnce({ status: 408 })
            .mockRejectedValueOnce({ status: 500 });
        mockClientLogin({ channels: { fetch: vi.fn().mockResolvedValue({ edit }) } });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const applyRename = () =>
            applyFluxerBotGuildStructureActions({
                actions: [
                    {
                        id: 'rename-channel',
                        actionType: 'update',
                        targetType: 'channel',
                        targetId: 'channel-1',
                        changes: [{ field: 'name', after: 'renamed' }],
                    },
                ],
                botToken: 'bot-token',
                guildId: 'guild-1',
                knownTargetKinds: { 'channel-1': 'channel', 'guild-1': 'role' },
                operationDelayMs: 0,
            });

        const badRequest = await applyRename();
        const requestTimeout = await applyRename();
        const serverFailure = await applyRename();

        expect(
            [badRequest, requestTimeout, serverFailure].map(
                (result) => result._unsafeUnwrap().actions[0]?.mutationOutcome
            )
        ).toStrictEqual(['not-applied', 'unknown', 'unknown']);
        expect(edit).toHaveBeenCalledTimes(3);
    });

    it('rejects suffix normalization failures before login', async () => {
        const login = vi.spyOn(Client.prototype, 'login');
        const onActionResult = vi.fn().mockResolvedValue(true);

        const result = await applyFluxerBotGuildStructureActions({
            actions: [{ id: 'action-1', actionType: 'update', targetType: 'channel' }],
            botToken: 'bot-token',
            guildId: 'guild-1',
            knownTargetKinds: { 'guild-1': 'role' },
            onActionResult,
            operationDelayMs: 0,
        });

        expect(result._unsafeUnwrapErr()).toMatchObject({ actionId: 'action-1' });
        expect(onActionResult).not.toHaveBeenCalled();
        expect(login).not.toHaveBeenCalled();
    });

    it('rejects compound role metadata and position updates before login', async () => {
        const login = vi.spyOn(Client.prototype, 'login');

        const result = await applyFluxerBotGuildStructureActions({
            actions: [
                {
                    id: 'compound-role-update',
                    actionType: 'update',
                    targetType: 'role',
                    targetId: 'role-1',
                    changes: [
                        { field: 'name', after: 'Renamed' },
                        { field: 'position', after: 2 },
                    ],
                },
            ],
            botToken: 'bot-token',
            guildId: 'guild-1',
            knownTargetKinds: { 'guild-1': 'role', 'role-1': 'role' },
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({
            actionId: 'compound-role-update',
            field: 'changes',
            type: 'invalid-value',
        });
        expect(login).not.toHaveBeenCalled();
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
            knownTargetKinds: {
                'guild-1': 'role',
                'channel-1': 'channel',
                'channel-2': 'channel',
                'channel-3': 'channel',
            },
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

    it('stops before later actions after the first hard failure', async () => {
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
            knownTargetKinds: { 'guild-1': 'role', 'channel-1': 'channel' },
            operationDelayMs: 0,
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
                {
                    id: 'action-delete-channel',
                    status: 'failed',
                    errorType: 'permission-denied',
                    mutationOutcome: 'not-applied',
                },
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
            knownTargetIds: ['channel-1'],
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
            knownTargetIds: ['role-1'],
            changes: [{ field: 'position', before: 1, after: 5 }],
        });
        const everyoneResult = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'update',
            targetType: 'role',
            targetId: 'guild-1',
            knownTargetIds: ['guild-1'],
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

        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'target-guild-1',
            knownTargetKinds: {
                'target-guild-1': 'role',
                'created-role-1': 'role',
            },
            sourceGuildId: 'source-guild-1',
            idMap: {
                'source-role-1': 'created-role-1',
            },
            operationDelayMs: 0,
            actions: [
                {
                    id: 'create-channel',
                    actionType: 'create',
                    targetType: 'channel',
                    targetId: 'source-channel-1',
                    after: {
                        id: 'source-channel-1',
                        name: 'announcements',
                        type: 0,
                        parentId: null,
                        permissionOverwrites: [],
                    },
                },
                {
                    id: 'set-role-overwrite',
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'source-channel-1',
                    changes: [
                        {
                            field: 'permissionOverwrites',
                            before: [],
                            after: [{ id: 'source-role-1', type: 0, allow: '1024', deny: '0' }],
                        },
                    ],
                },
                {
                    id: 'set-everyone-overwrite',
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'source-channel-1',
                    changes: [
                        {
                            field: 'permissionOverwrites',
                            before: [],
                            after: [{ id: 'source-guild-1', type: 0, allow: '0', deny: '2048' }],
                        },
                    ],
                },
            ],
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

    it('rejects compound channel creates before login', async () => {
        const login = vi.spyOn(Client.prototype, 'login');
        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'target-guild-1',
            knownTargetKinds: { 'target-guild-1': 'role' },
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
                        permissionOverwrites: [{ id: 'target-guild-1', type: 0, allow: '0', deny: '2048' }],
                    },
                },
            ],
        });

        expect(result._unsafeUnwrapErr()).toMatchObject({ type: 'invalid-value' });
        expect(login).not.toHaveBeenCalled();
    });

    it('rejects already-mapped channel creates as an execution invariant violation', async () => {
        const login = vi.spyOn(Client.prototype, 'login');
        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'target-guild-1',
            knownTargetKinds: { 'target-guild-1': 'role', 'created-channel-1': 'channel' },
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
                        permissionOverwrites: [],
                    },
                },
            ],
        });

        expect(result._unsafeUnwrapErr()).toMatchObject({ type: 'invalid-value' });
        expect(login).not.toHaveBeenCalled();
    });

    it('deletes a mapped channel before recreating the same source with a new provider id', async () => {
        const deleteChannel = vi.fn().mockResolvedValue(undefined);
        const createChannel = vi.fn().mockResolvedValue({ id: 'new-channel-1', guildId: 'target-guild-1' });
        mockClientLogin({
            channels: {
                fetch: vi.fn().mockResolvedValue({
                    delete: deleteChannel,
                    deletePermission: vi.fn(),
                    editPermission: vi.fn(),
                }),
            },
            guilds: {
                fetch: vi.fn().mockResolvedValue({ createChannel }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureActions({
            actions: [
                {
                    id: 'delete-old-channel',
                    actionType: 'delete',
                    targetType: 'channel',
                    targetId: 'source-channel-1',
                },
                {
                    id: 'create-new-channel',
                    actionType: 'create',
                    targetType: 'channel',
                    targetId: 'source-channel-1',
                    after: {
                        id: 'source-channel-1',
                        name: 'announcements',
                        type: 0,
                        parentId: null,
                        permissionOverwrites: [],
                    },
                },
            ],
            botToken: 'bot-token',
            guildId: 'target-guild-1',
            idMap: { 'source-channel-1': 'old-channel-1' },
            knownTargetKinds: { 'old-channel-1': 'channel', 'target-guild-1': 'role' },
            operationDelayMs: 0,
            referenceIdMap: { 'source-channel-1': 'old-channel-1' },
        });

        expect(result._unsafeUnwrap()).toStrictEqual({
            actions: [
                { id: 'delete-old-channel', status: 'applied' },
                { createdId: 'new-channel-1', id: 'create-new-channel', status: 'applied' },
            ],
            idMap: { 'source-channel-1': 'new-channel-1' },
        });
        expect(deleteChannel).toHaveBeenCalledOnce();
        expect(createChannel).toHaveBeenCalledOnce();
    });

    it('rejects already-mapped role creates before login', async () => {
        const login = vi.spyOn(Client.prototype, 'login');
        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'target-guild-1',
            knownTargetKinds: { 'target-guild-1': 'role', 'created-role-1': 'role' },
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

        expect(result._unsafeUnwrapErr()).toMatchObject({ type: 'invalid-value' });
        expect(login).not.toHaveBeenCalled();
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
            knownTargetKinds: { 'guild-1': 'role' },
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
            knownTargetKinds: { 'guild-1': 'role' },
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
                {
                    id: 'action-role-order',
                    actionType: 'update',
                    targetType: 'role-order',
                    after: [
                        { sourceId: 'source-role-low', position: 3, hierarchyRank: 1 },
                        { sourceId: 'source-role-top', position: 8, hierarchyRank: 0 },
                    ],
                },
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
                { id: 'action-role-order', status: 'applied' },
            ],
            idMap: {
                'source-role-top': 'created-role-top',
                'source-role-low': 'created-role-low',
            },
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
            knownTargetKinds: {
                'guild-1': 'role',
                'target-category-a': 'category',
                'target-category-b': 'category',
                'target-channel-a-1': 'channel',
                'target-channel-a-2': 'channel',
                'target-channel-b': 'channel',
            },
            operationDelayMs: 0,
            actions: [
                {
                    id: 'action-channel-order',
                    actionType: 'update',
                    targetType: 'channel-order',
                    after: [
                        { sourceId: 'source-category-b', parentSourceId: null, position: 20 },
                        { sourceId: 'source-channel-b', parentSourceId: 'source-category-b', position: 21 },
                        { sourceId: 'source-channel-a-2', parentSourceId: 'source-category-a', position: 3 },
                        { sourceId: 'source-category-a', parentSourceId: null, position: 1 },
                        { sourceId: 'source-channel-a-1', parentSourceId: 'source-category-a', position: 2 },
                    ],
                },
            ],
            idMap: {
                'source-category-a': 'target-category-a',
                'source-category-b': 'target-category-b',
                'source-channel-a-1': 'target-channel-a-1',
                'source-channel-a-2': 'target-channel-a-2',
                'source-channel-b': 'target-channel-b',
            },
        });

        expect(result.isOk()).toBe(true);
        expect(setChannelPositions).toHaveBeenCalledWith([
            { id: 'target-category-a', parent_id: null, position: 0 },
            { id: 'target-category-b', parent_id: null, position: 1 },
            { id: 'target-channel-a-1', parent_id: 'target-category-a', position: 0 },
            { id: 'target-channel-a-2', parent_id: 'target-category-a', position: 1 },
            { id: 'target-channel-b', parent_id: 'target-category-b', position: 0 },
        ]);
        expect(result._unsafeUnwrap().actions).toStrictEqual([{ id: 'action-channel-order', status: 'applied' }]);
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
            knownTargetKinds: {
                'target-guild': 'role',
                'target-category': 'category',
                'target-role': 'role',
            },
            operationDelayMs: 0,
            actions: [
                {
                    id: 'action-channel-order',
                    actionType: 'update',
                    targetType: 'channel-order',
                    after: [
                        { sourceId: 'source-category', parentSourceId: null, position: 0 },
                        { sourceId: 'source-channel-missing', parentSourceId: 'source-category', position: 1 },
                    ],
                },
                {
                    id: 'action-role-order',
                    actionType: 'update',
                    targetType: 'role-order',
                    after: [
                        { sourceId: 'source-role', position: 2 },
                        { sourceId: 'source-role-missing', position: 1 },
                    ],
                },
            ],
            idMap: {
                'source-category': 'target-category',
                'source-role': 'target-role',
            },
        });

        expect(result._unsafeUnwrapErr()).toMatchObject({ type: 'structure-order-mapping-missing' });
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
            knownTargetKinds: {
                'target-guild': 'role',
                'target-channel': 'channel',
                'target-role': 'role',
            },
            operationDelayMs: 0,
            actions: [
                {
                    id: 'action-channel-order',
                    actionType: 'update',
                    targetType: 'channel-order',
                    after: [
                        { sourceId: 'source-channel-a', parentSourceId: null, position: 0 },
                        { sourceId: 'source-channel-b', parentSourceId: null, position: 1 },
                    ],
                },
                {
                    id: 'action-role-order',
                    actionType: 'update',
                    targetType: 'role-order',
                    after: [
                        { sourceId: 'source-role', position: 2 },
                        { sourceId: ' ', position: 1 },
                    ],
                },
            ],
            idMap: {
                'source-channel-a': 'target-channel',
                'source-channel-b': 'target-channel',
                'source-role': 'target-role',
            },
        });

        expect(result._unsafeUnwrapErr()).toMatchObject({ type: 'invalid-value' });
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
            knownTargetKinds: { 'guild-1': 'role', 'channel-1': 'channel', 'channel-2': 'channel' },
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
                {
                    id: 'action-second',
                    status: 'failed',
                    errorType: 'apply-lease-lost',
                    mutationOutcome: 'not-applied',
                },
            ],
            idMap: {},
        });
        expect(edit).toHaveBeenCalledOnce();
        expect(beforeMutation).toHaveBeenCalledTimes(2);
    });

    it('rejects a compound overwrite replacement before any provider mutation', async () => {
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
        const beforeMutation = vi.fn();

        const result = await applyFluxerBotGuildStructureActions({
            botToken: 'bot-token',
            guildId: 'guild-1',
            knownTargetKinds: {
                'guild-1': 'role',
                'channel-1': 'channel',
                'role-1': 'role',
                'role-2': 'role',
            },
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

        expect(result._unsafeUnwrapErr()).toMatchObject({ type: 'invalid-value' });
        expect(beforeMutation).not.toHaveBeenCalled();
        expect(editPermission).not.toHaveBeenCalled();
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
            knownTargetIds: ['role-1'],
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
            knownTargetIds: ['channel-1'],
            changes: [{ field: 'name', after: 'announcements' }],
        });

        expect(result.isOk()).toBe(true);
        expect(edit).toHaveBeenCalledWith({
            name: 'announcements',
        });
    });

    it('applies one permission-overwrite upsert per execution action', async () => {
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
            knownTargetIds: ['channel-1', 'role-changed'],
            changes: [
                {
                    field: 'permissionOverwrites',
                    before: [
                        {
                            id: 'role-changed',
                            type: 0,
                            allow: '0',
                            deny: '1024',
                        },
                    ],
                    after: [
                        {
                            id: 'role-changed',
                            type: 0,
                            allow: '1024',
                            deny: '0',
                        },
                    ],
                },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(deletePermission).not.toHaveBeenCalled();
        expect(editPermission).toHaveBeenCalledExactlyOnceWith('role-changed', {
            type: 0,
            allow: '1024',
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
            knownTargetIds: ['channel-1'],
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
            knownTargetIds: ['role-1'],
        });

        expect(result.isOk()).toBe(true);
        expect(deleteRole).toHaveBeenCalledWith('/guilds/guild-1/roles/role-1', { auth: true });
    });

    it.each(['channel', 'category'] as const)(
        'treats an already-absent %s as a successful convergent delete',
        async (targetType) => {
            mockClientLogin({
                channels: {
                    fetch: vi.fn().mockRejectedValue({ status: 404 }),
                },
            });
            vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

            const result = await applyFluxerBotGuildStructureAction({
                botToken: 'bot-token',
                guildId: 'guild-1',
                actionType: 'delete',
                targetType,
                targetId: `${targetType}-1`,
                knownTargetIds: [`${targetType}-1`],
            });

            expect(result._unsafeUnwrap()).toStrictEqual({});
        }
    );

    it('treats an already-absent role as a successful convergent delete', async () => {
        mockClientLogin({
            rest: {
                delete: vi.fn().mockRejectedValue({ status: 404 }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'delete',
            targetType: 'role',
            targetId: 'role-1',
            knownTargetIds: ['role-1'],
        });

        expect(result._unsafeUnwrap()).toStrictEqual({});
    });

    it('treats an already-absent permission overwrite as a successful convergent delete', async () => {
        const deletePermission = vi.fn().mockRejectedValue({ status: 404 });
        mockClientLogin({
            channels: {
                fetch: vi.fn().mockResolvedValue({
                    delete: vi.fn(),
                    editPermission: vi.fn(),
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
            knownTargetIds: ['channel-1', 'role-1'],
            changes: [
                {
                    field: 'permissionOverwrites',
                    before: [{ id: 'role-1', type: 0, allow: '0', deny: '1024' }],
                    after: [],
                },
            ],
        });

        expect(result._unsafeUnwrap()).toStrictEqual({});
        expect(deletePermission).toHaveBeenCalledExactlyOnceWith('role-1');
    });

    it('does not treat not-found as success for updates', async () => {
        mockClientLogin({
            channels: {
                fetch: vi.fn().mockRejectedValue({ status: 404 }),
            },
        });
        vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined);

        const result = await applyFluxerBotGuildStructureAction({
            botToken: 'bot-token',
            guildId: 'guild-1',
            actionType: 'update',
            targetType: 'channel',
            targetId: 'channel-1',
            knownTargetIds: ['channel-1'],
            changes: [{ field: 'name', after: 'renamed' }],
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('does not treat not-found as success for creates', async () => {
        mockClientLogin({
            guilds: {
                fetch: vi.fn().mockRejectedValue({ status: 404 }),
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
                permissions: '0',
                color: 0,
                hoist: false,
                mentionable: false,
            },
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
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
    const probe = new Client();
    for (const [componentName, componentOverrides] of Object.entries(overrides)) {
        const component = probe[componentName as keyof FluxerClient];
        if (
            typeof component !== 'object' ||
            component === null ||
            typeof componentOverrides !== 'object' ||
            componentOverrides === null
        )
            continue;
        const prototype = Object.getPrototypeOf(component) as Record<string, (...args: never[]) => unknown>;
        for (const [method, implementation] of Object.entries(componentOverrides)) {
            if (typeof implementation !== 'function') continue;
            vi.spyOn(prototype, method).mockImplementation(implementation as never);
        }
    }
    return vi.spyOn(Client.prototype, 'login');
}
