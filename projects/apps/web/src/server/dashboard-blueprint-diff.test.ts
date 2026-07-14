import { describe, expect, it } from 'vitest';

import {
    diffDashboardBlueprintSnapshot,
    normalizeDashboardBlueprintSnapshot,
    toDashboardBlueprintSnapshot,
} from './dashboard-blueprint-diff.js';

describe('dashboard structure diff', () => {
    it('normalizes a Fluxer-compatible structure snapshot', () => {
        const result = normalizeDashboardBlueprintSnapshot({
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
            normalizeDashboardBlueprintSnapshot({
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
            normalizeDashboardBlueprintSnapshot({
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
        expect(
            normalizeDashboardBlueprintSnapshot({
                guildId: 'guild-1',
                guildName: '   ',
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
            normalizeDashboardBlueprintSnapshot({
                roles: [],
                categories: [],
                channels: [{ id: 'channel-1' }],
            })
        ).toStrictEqual({
            type: 'invalid',
            message: 'Server blueprint JSON must include valid roles, categories, and channels arrays.',
        });
    });

    it('plans creates, updates, and deletes against the current server layout', () => {
        const current = toDashboardBlueprintSnapshot(
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

        expect(current).toMatchObject({
            guildId: 'guild-1',
            guildName: 'Guild 1',
            exportedAt: '2026-06-26T10:00:00.000Z',
        });

        const plan = diffDashboardBlueprintSnapshot(current, requested, { policy: 'synchronize' });

        expect(plan.summary).toStrictEqual({
            creates: 1,
            updates: 2,
            deletes: 1,
            roles: 4,
            categories: 0,
            channels: 0,
        });
        expect(plan.steps.map((action) => [action.actionType, action.targetType, action.targetId])).toStrictEqual([
            ['create', 'role', 'role-new'],
            ['update', 'role', 'role-1'],
            ['delete', 'role', 'role-stale'],
            ['update', 'role-order', 'role-order'],
        ]);
        expect(plan.steps.find((step) => step.targetId === 'role-1')?.details).toMatchObject({
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
