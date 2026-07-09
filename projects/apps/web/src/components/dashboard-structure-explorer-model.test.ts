import { describe, expect, it } from 'vitest';

import {
    buildDashboardStructureExplorerModel,
    parseDashboardStructureExplorerSnapshot,
    toDashboardStructureExplorerActions,
} from './dashboard-structure-explorer-model.js';
import type {
    DashboardStructureExplorerAction,
    DashboardStructureExplorerSnapshot,
} from './dashboard-structure-explorer-model.js';

describe('buildDashboardStructureExplorerModel', () => {
    it('builds root hierarchy with normalized role and channel ordering', () => {
        const model = buildDashboardStructureExplorerModel({ snapshot: createSnapshot() });

        expect(model.paths).toContain('Roles/');
        expect(model.paths).toContain('Categories/');
        expect(model.paths).toContain('Uncategorized Channels/');
        expect(indexOfPath(model, 'Roles/Admin [role-admin]')).toBeLessThan(
            indexOfPath(model, 'Roles/Member [role-member]')
        );
        expect(indexOfPath(model, 'Roles/Member [role-member]')).toBeLessThan(
            indexOfPath(model, 'Roles/@everyone [guild-1]')
        );
        expect(indexOfPath(model, 'Categories/General [category-general]/general [channel-general]')).toBeLessThan(
            indexOfPath(model, 'Categories/General [category-general]/updates [channel-updates]')
        );
    });

    it('places channels under categories or uncategorized fallback', () => {
        const model = buildDashboardStructureExplorerModel({ snapshot: createSnapshot() });

        expect(model.pathMetadata.get('Categories/General [category-general]/general [channel-general]')).toMatchObject(
            {
                entityKey: 'channel:channel-general',
                kind: 'channel',
                parentId: 'category-general',
            }
        );
        expect(model.pathMetadata.get('Uncategorized Channels/lobby [channel-lobby]')).toMatchObject({
            entityKey: 'channel:channel-lobby',
            kind: 'channel',
            parentId: 'missing-category',
        });
    });

    it('attaches action, move, permission, blocked, failed, and retry badges', () => {
        const actions: DashboardStructureExplorerAction[] = [
            createAction({
                actionType: 'update',
                details: {
                    changes: [
                        { field: 'parentId', before: null, after: 'category-general' },
                        { field: 'permissionOverwrites', before: [], after: [{ id: 'role-admin' }] },
                    ],
                },
                targetId: 'channel-lobby',
                targetType: 'channel',
            }),
            createAction({
                actionType: 'update',
                details: { changes: [{ field: 'type', before: 0, after: 5 }] },
                targetId: 'channel-general',
                targetType: 'channel',
            }),
            createAction({
                actionType: 'create',
                details: { createdId: 'created-channel-1' },
                status: 'failed',
                targetId: 'channel-new',
                targetType: 'channel',
            }),
        ];
        const model = buildDashboardStructureExplorerModel({ actions, snapshot: createSnapshot() });

        expect(model.pathMetadata.get('Uncategorized Channels/lobby [channel-lobby]')?.badges).toEqual(
            expect.arrayContaining(['move', 'permissions', 'update'])
        );
        expect(
            model.pathMetadata.get('Categories/General [category-general]/general [channel-general]')?.badges
        ).toEqual(expect.arrayContaining(['blocked', 'unsupported']));
        expect(model.pathMetadata.get('Uncategorized Channels/channel-new [channel-new]')?.badges).toEqual(
            expect.arrayContaining(['create', 'failed', 'retry'])
        );
        expect(model.paths).toContain('Blocked / Unsupported/channel-general [action-1]');
    });

    it('marks @everyone position changes as blocked without blocking normal role moves', () => {
        const model = buildDashboardStructureExplorerModel({
            actions: [
                createAction({
                    actionType: 'update',
                    details: { changes: [{ field: 'position', before: 1, after: 3 }] },
                    targetId: 'role-member',
                    targetType: 'role',
                }),
                createAction({
                    actionType: 'update',
                    details: { changes: [{ field: 'position', before: 0, after: 1 }] },
                    targetId: 'guild-1',
                    targetType: 'role',
                }),
            ],
            snapshot: createSnapshot(),
        });

        expect(model.pathMetadata.get('Roles/Member [role-member]')?.badges).toContain('move');
        expect(model.pathMetadata.get('Roles/Member [role-member]')?.badges).not.toContain('blocked');
        expect(model.pathMetadata.get('Roles/@everyone [guild-1]')?.badges).toEqual(
            expect.arrayContaining(['blocked', 'unsupported'])
        );
        expect(model.pathMetadata.get('Roles/@everyone [guild-1]')?.risks).toContain('@everyone cannot be moved.');
    });

    it('keeps unsafe names from breaking tree paths', () => {
        const model = buildDashboardStructureExplorerModel({
            snapshot: {
                ...createSnapshot(),
                categories: [{ ...createSnapshot().categories[0], name: 'Ops/Live\u0000' }],
                channels: [{ ...createSnapshot().channels[0], name: '' }],
            },
        });

        expect(model.paths).toContain('Categories/Ops Live [category-general]/Unnamed [channel-updates]');
    });

    it('converts drift/import actions and attaches preflight statuses', () => {
        const actions = toDashboardStructureExplorerActions(
            [
                {
                    actionType: 'delete',
                    details: { before: { id: 'role-member', name: 'Member' } },
                    fields: [],
                    id: 'action-1',
                    label: 'Member',
                    sequence: 1,
                    targetId: 'role-member',
                    targetType: 'role',
                },
            ],
            {
                actions: [
                    {
                        actionId: 'action-1',
                        actionType: 'delete',
                        message: 'Delete approval required.',
                        status: 'destructive-approval-required',
                        targetId: 'role-member',
                        targetType: 'role',
                    },
                ],
                summary: {
                    destructiveApprovalRequired: 1,
                    invalidPlan: 0,
                    mappingRequired: 0,
                    ready: 0,
                    stale: 0,
                    total: 1,
                    unsupported: 0,
                },
            }
        );
        const model = buildDashboardStructureExplorerModel({ actions, snapshot: createSnapshot() });

        expect(model.pathMetadata.get('Roles/Member [role-member]')?.badges).toEqual(
            expect.arrayContaining(['delete', 'destructive'])
        );
        expect(model.pathMetadata.get('Roles/Member [role-member]')?.risks).toContain('Delete approval required.');
    });

    it('parses valid explorer snapshots and rejects invalid JSON', () => {
        const snapshotWithoutGuildName = { ...createSnapshot() };
        delete snapshotWithoutGuildName.guildName;

        expect(parseDashboardStructureExplorerSnapshot(JSON.stringify(createSnapshot()))).toMatchObject({
            guildName: 'Guild 1',
            roles: expect.any(Array),
        });
        expect(parseDashboardStructureExplorerSnapshot(JSON.stringify(snapshotWithoutGuildName))).toMatchObject({
            guildId: 'guild-1',
            roles: expect.any(Array),
        });
        expect(
            parseDashboardStructureExplorerSnapshot(JSON.stringify({ ...createSnapshot(), guildName: '  Renamed  ' }))
        ).toMatchObject({
            guildName: 'Renamed',
        });
        expect(parseDashboardStructureExplorerSnapshot('{')).toBeUndefined();
        expect(parseDashboardStructureExplorerSnapshot('{"roles":[]}')).toBeUndefined();
    });
});

function indexOfPath(model: ReturnType<typeof buildDashboardStructureExplorerModel>, path: string): number {
    const index = model.paths.indexOf(path);
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
}

function createAction(overrides: Partial<DashboardStructureExplorerAction> = {}): DashboardStructureExplorerAction {
    return {
        actionType: 'update',
        details: {},
        id: 'action-1',
        label: overrides.targetId ?? 'general',
        targetId: 'channel-general',
        targetType: 'channel',
        ...overrides,
    };
}

function createSnapshot(): DashboardStructureExplorerSnapshot {
    return {
        exportedAt: '2026-07-09T10:00:00.000Z',
        guildId: 'guild-1',
        guildName: 'Guild 1',
        version: 1,
        roles: [
            {
                color: 0,
                hoist: false,
                id: 'role-member',
                mentionable: false,
                name: 'Member',
                permissions: '1',
                position: 1,
            },
            {
                color: 0,
                hoist: true,
                id: 'role-admin',
                mentionable: true,
                name: 'Admin',
                permissions: '8',
                position: 5,
            },
            {
                color: 0,
                hoist: false,
                id: 'guild-1',
                mentionable: false,
                name: '@everyone',
                permissions: '0',
                position: 0,
            },
        ],
        categories: [
            {
                id: 'category-general',
                name: 'General',
                parentId: null,
                permissionOverwrites: [],
                position: 1,
                type: 4,
            },
        ],
        channels: [
            {
                id: 'channel-updates',
                name: 'updates',
                parentId: 'category-general',
                permissionOverwrites: [],
                position: 2,
                type: 0,
            },
            {
                id: 'channel-general',
                name: 'general',
                parentId: 'category-general',
                permissionOverwrites: [],
                position: 1,
                type: 0,
            },
            {
                id: 'channel-lobby',
                name: 'lobby',
                parentId: 'missing-category',
                permissionOverwrites: [],
                position: 1,
                type: 2,
            },
        ],
    };
}
