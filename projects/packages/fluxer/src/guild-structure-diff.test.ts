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
});
