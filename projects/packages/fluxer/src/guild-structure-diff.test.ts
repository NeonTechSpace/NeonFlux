import { describe, expect, it } from 'vitest';

import {
    diffFluxerGuildStructureSnapshot,
    normalizeFluxerGuildStructureSnapshot,
    toFluxerGuildStructureSnapshot,
} from './guild-structure-diff.js';

describe('guild structure diff', () => {
    it('normalizes a Fluxer-compatible structure snapshot', () => {
        const result = normalizeFluxerGuildStructureSnapshot({
            guildId: ' guild-1 ',
            guildName: ' Guild 1 ',
            botHighestRolePosition: 6,
            roles: [
                {
                    id: 'role-1',
                    name: 'Member',
                    position: 1,
                    color: 0,
                    permissions: '0',
                    hoist: false,
                    mentionable: false,
                },
            ],
            categories: [],
            channels: [
                {
                    id: 'channel-1',
                    name: 'general',
                    type: 0,
                    url: 'https://example.com/general',
                    parentId: null,
                    position: 1,
                    permissionOverwrites: [],
                },
            ],
        });

        expect(result).toStrictEqual({
            type: 'valid',
            snapshot: {
                version: 1,
                guildId: 'guild-1',
                guildName: 'Guild 1',
                botHighestRolePosition: 6,
                roles: [
                    {
                        id: 'role-1',
                        name: 'Member',
                        position: 1,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                ],
                categories: [],
                channels: [
                    {
                        id: 'channel-1',
                        name: 'general',
                        type: 0,
                        url: 'https://example.com/general',
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                ],
            },
        });
    });

    it('keeps guildName optional and ignores invalid guildName metadata', () => {
        expect(
            normalizeFluxerGuildStructureSnapshot({
                guildId: 'guild-1',
                roles: [],
                categories: [],
                channels: [],
            })
        ).toStrictEqual({
            type: 'valid',
            snapshot: {
                version: 1,
                guildId: 'guild-1',
                roles: [],
                categories: [],
                channels: [],
            },
        });
        expect(
            normalizeFluxerGuildStructureSnapshot({
                guildId: 'guild-1',
                guildName: 123,
                roles: [],
                categories: [],
                channels: [],
            })
        ).toStrictEqual({
            type: 'valid',
            snapshot: {
                version: 1,
                guildId: 'guild-1',
                roles: [],
                categories: [],
                channels: [],
            },
        });
    });

    it('rejects malformed structure snapshots', () => {
        expect(
            normalizeFluxerGuildStructureSnapshot({
                roles: [],
                categories: [],
                channels: [{ id: 'channel-1' }],
            })
        ).toStrictEqual({
            type: 'invalid',
            message: 'Server blueprint JSON must include valid roles, categories, and channels arrays.',
        });
    });

    it('plans creates, updates, deletes, and permission changes against the current server layout', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'guild-1',
                guildName: 'Guild 1',
                roles: [
                    {
                        id: 'role-1',
                        name: 'Member',
                        position: 1,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                    {
                        id: 'role-stale',
                        name: 'Stale',
                        position: 2,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                ],
                categories: [],
                channels: [
                    {
                        id: 'channel-1',
                        name: 'general',
                        type: 0,
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                ],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const currentRole = current.roles[0];
        const currentChannel = current.channels[0];
        if (!currentRole || !currentChannel) throw new Error('fixture-invalid');

        const requested = {
            ...current,
            roles: [
                {
                    ...currentRole,
                    name: 'Members',
                },
                {
                    id: 'role-new',
                    name: 'New',
                    position: 3,
                    color: 0,
                    permissions: '0',
                    hoist: false,
                    mentionable: false,
                },
            ],
            channels: [
                {
                    ...currentChannel,
                    permissionOverwrites: [{ id: 'role-1', type: 0, allow: '1', deny: '0' }],
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested);

        expect(plan.summary).toStrictEqual({
            creates: 1,
            updates: 2,
            deletes: 1,
            roles: 3,
            categories: 0,
            channels: 1,
        });
        expect(plan.actions.map((action) => [action.actionType, action.targetType, action.targetId])).toStrictEqual([
            ['update', 'role', 'role-1'],
            ['create', 'role', 'role-new'],
            ['delete', 'role', 'role-stale'],
            ['update', 'channel', 'channel-1'],
        ]);
        expect(plan.actions.at(-1)?.details).toMatchObject({
            changes: [
                {
                    field: 'permissionOverwrites',
                    before: [],
                    after: [{ id: 'role-1', type: 0, allow: '1', deny: '0' }],
                },
            ],
        });
    });

    it('ignores protected roles when planning imports', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'guild-1',
                guildName: 'Guild 1',
                roles: [
                    {
                        id: 'guild-1',
                        name: '@everyone',
                        position: 0,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                    {
                        id: 'bot-role-current',
                        name: 'Bot',
                        position: 10,
                        color: 0,
                        permissions: '0',
                        hoist: true,
                        mentionable: false,
                        protected: true,
                        protectionReason: 'bot',
                    },
                    {
                        id: 'role-1',
                        name: 'Member',
                        position: 1,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                ],
                categories: [],
                channels: [],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const requested = {
            ...current,
            guildId: 'source-guild',
            roles: [
                {
                    id: 'source-guild',
                    name: '@everyone',
                    position: 0,
                    color: 0,
                    permissions: '8',
                    hoist: false,
                    mentionable: false,
                },
                {
                    id: 'bot-role-requested',
                    name: 'Imported Bot',
                    position: 11,
                    color: 0,
                    permissions: '0',
                    hoist: true,
                    mentionable: false,
                    protected: true as const,
                    protectionReason: 'integration' as const,
                },
                {
                    id: 'role-1',
                    name: 'Members',
                    position: 1,
                    color: 0,
                    permissions: '0',
                    hoist: false,
                    mentionable: false,
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested);

        expect(plan.actions).toStrictEqual([
            {
                actionType: 'update',
                targetType: 'role',
                targetId: 'role-1',
                label: 'Members',
                details: {
                    label: 'Members',
                    sourceId: 'role-1',
                    changes: [{ field: 'name', before: 'Member', after: 'Members' }],
                },
            },
        ]);
    });

    it('matches unique same-name roles instead of planning duplicate create and delete actions', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'target-guild',
                guildName: 'Target Guild',
                roles: [
                    {
                        id: 'target-member',
                        name: 'Member',
                        position: 1,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                ],
                categories: [],
                channels: [],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const requested = {
            ...current,
            guildId: 'source-guild',
            roles: [
                {
                    id: 'source-member',
                    name: 'Member',
                    position: 5,
                    color: 255,
                    permissions: '8',
                    hoist: true,
                    mentionable: true,
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested);

        expect(plan.summary).toStrictEqual({
            creates: 0,
            updates: 1,
            deletes: 0,
            roles: 1,
            categories: 0,
            channels: 0,
        });
        expect(plan.actions).toStrictEqual([
            {
                actionType: 'update',
                targetType: 'role',
                targetId: 'target-member',
                label: 'Member',
                details: {
                    label: 'Member',
                    sourceId: 'source-member',
                    changes: [
                        { field: 'position', before: 1, after: 5 },
                        { field: 'color', before: 0, after: 255 },
                        { field: 'permissions', before: '0', after: '8' },
                        { field: 'hoist', before: false, after: true },
                        { field: 'mentionable', before: false, after: true },
                    ],
                },
            },
        ]);
    });

    it('reset-before-create mode deletes eligible current roles and recreates same-name requested roles', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'target-guild',
                guildName: 'Target Guild',
                roles: [
                    {
                        id: 'target-guild',
                        name: '@everyone',
                        position: 0,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                    {
                        id: 'target-member',
                        name: 'Member',
                        position: 1,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                ],
                categories: [],
                channels: [],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const requested = {
            ...current,
            guildId: 'source-guild',
            roles: [
                {
                    id: 'source-guild',
                    name: '@everyone',
                    position: 0,
                    color: 0,
                    permissions: '8',
                    hoist: false,
                    mentionable: false,
                },
                {
                    id: 'source-member',
                    name: 'Member',
                    position: 5,
                    color: 255,
                    permissions: '8',
                    hoist: true,
                    mentionable: true,
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested, {
            includeDeletes: true,
            resetBeforeCreate: true,
        });

        expect(plan.summary).toStrictEqual({
            creates: 1,
            updates: 0,
            deletes: 1,
            roles: 2,
            categories: 0,
            channels: 0,
        });
        expect(plan.actions.map((action) => [action.actionType, action.targetType, action.targetId])).toStrictEqual([
            ['delete', 'role', 'target-member'],
            ['create', 'role', 'source-member'],
        ]);
    });

    it('uses a unique exact same-name role match when duplicate roles already exist', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'target-guild',
                guildName: 'Target Guild',
                roles: [
                    {
                        id: 'target-member-duplicate',
                        name: 'Member',
                        position: 2,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                    {
                        id: 'target-member-kept',
                        name: 'Member',
                        position: 5,
                        color: 255,
                        permissions: '8',
                        hoist: true,
                        mentionable: true,
                    },
                ],
                categories: [],
                channels: [],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const requested = {
            ...current,
            guildId: 'source-guild',
            roles: [
                {
                    id: 'source-member',
                    name: 'Member',
                    position: 5,
                    color: 255,
                    permissions: '8',
                    hoist: true,
                    mentionable: true,
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested);

        expect(plan.summary).toStrictEqual({
            creates: 0,
            updates: 0,
            deletes: 1,
            roles: 1,
            categories: 0,
            channels: 0,
        });
        expect(plan.actions).toStrictEqual([
            {
                actionType: 'delete',
                targetType: 'role',
                targetId: 'target-member-duplicate',
                label: 'Member',
                details: {
                    label: 'Member',
                    before: {
                        id: 'target-member-duplicate',
                        name: 'Member',
                        position: 2,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                },
            },
        ]);
    });

    it('can omit deletes for merge-mode import previews', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'guild-1',
                guildName: 'Guild 1',
                roles: [
                    {
                        id: 'role-extra',
                        name: 'Extra',
                        position: 1,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                ],
                categories: [],
                channels: [],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const requested = { ...current, roles: [] };

        expect(diffFluxerGuildStructureSnapshot(current, requested).summary.deletes).toBe(1);
        expect(diffFluxerGuildStructureSnapshot(current, requested, { includeDeletes: false }).actions).toStrictEqual(
            []
        );
    });

    it('matches same-name same-type channels through matched category names without planning create and delete', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'guild-1',
                guildName: 'Guild 1',
                roles: [],
                categories: [
                    {
                        id: 'current-category',
                        name: 'Links',
                        type: 4,
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                ],
                channels: [
                    {
                        id: 'current-link',
                        name: 'docs',
                        type: 998,
                        url: 'https://github.com/example/current',
                        parentId: 'current-category',
                        position: 1,
                        permissionOverwrites: [],
                    },
                ],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const requested = {
            ...current,
            categories: [
                {
                    id: 'requested-category',
                    name: 'Links',
                    type: 4,
                    parentId: null,
                    position: 1,
                    permissionOverwrites: [],
                },
            ],
            channels: [
                {
                    id: 'requested-link',
                    name: 'docs',
                    type: 998,
                    url: 'https://github.com/example/requested',
                    parentId: 'requested-category',
                    position: 2,
                    permissionOverwrites: [],
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested);

        expect(plan.summary).toStrictEqual({
            creates: 0,
            updates: 1,
            deletes: 0,
            roles: 0,
            categories: 0,
            channels: 1,
        });
        expect(plan.actions).toStrictEqual([
            {
                actionType: 'update',
                targetType: 'channel',
                targetId: 'current-link',
                label: 'docs',
                details: {
                    label: 'docs',
                    changes: [{ field: 'position', before: 1, after: 2 }],
                },
            },
        ]);
    });

    it('does not match same-name channels with different types as an update', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'guild-1',
                guildName: 'Guild 1',
                roles: [],
                categories: [],
                channels: [
                    {
                        id: 'current-text',
                        name: 'docs',
                        type: 0,
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                ],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const requested = {
            ...current,
            channels: [
                {
                    id: 'requested-link',
                    name: 'docs',
                    type: 5,
                    parentId: null,
                    position: 1,
                    permissionOverwrites: [],
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested);

        expect(plan.actions.map((action) => [action.actionType, action.targetType, action.targetId])).toStrictEqual([
            ['create', 'channel', 'requested-link'],
            ['delete', 'channel', 'current-text'],
        ]);
    });
});
