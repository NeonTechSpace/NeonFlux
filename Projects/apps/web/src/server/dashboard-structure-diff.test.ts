import { describe, expect, it } from 'vitest';

import {
    diffDashboardStructureSnapshot,
    normalizeDashboardStructureSnapshot,
    toDashboardStructureSnapshot,
} from './dashboard-structure-diff.js';

describe('dashboard structure diff', () => {
    it('normalizes a Fluxer-compatible structure snapshot', () => {
        const result = normalizeDashboardStructureSnapshot({
            guildId: ' guild-1 ',
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

    it('rejects malformed structure snapshots', () => {
        expect(
            normalizeDashboardStructureSnapshot({
                roles: [],
                categories: [],
                channels: [{ id: 'channel-1' }],
            })
        ).toStrictEqual({
            type: 'invalid',
            message: 'Structure JSON must include valid roles, categories, and channels arrays.',
        });
    });

    it('plans creates, updates, and deletes against the current structure', () => {
        const current = toDashboardStructureSnapshot(
            {
                guildId: 'guild-1',
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
        const requested = {
            ...current,
            roles: [
                {
                    ...current.roles[0],
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
        };

        const plan = diffDashboardStructureSnapshot(current, requested);

        expect(plan.summary).toStrictEqual({
            creates: 1,
            updates: 1,
            deletes: 1,
            roles: 3,
            categories: 0,
            channels: 0,
        });
        expect(plan.actions.map((action) => [action.actionType, action.targetType, action.targetId])).toStrictEqual([
            ['update', 'role', 'role-1'],
            ['create', 'role', 'role-new'],
            ['delete', 'role', 'role-stale'],
        ]);
        expect(plan.actions[0]?.details).toMatchObject({
            changes: [
                {
                    field: 'name',
                    before: 'Member',
                    after: 'Members',
                },
            ],
        });
    });
});
