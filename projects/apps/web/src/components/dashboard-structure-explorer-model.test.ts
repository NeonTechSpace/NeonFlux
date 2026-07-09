import { describe, expect, it } from 'vitest';

import {
    buildDashboardStructureExplorerModel,
    parseDashboardStructureExplorerSnapshot,
    toDashboardStructureExplorerActions,
} from './dashboard-structure-explorer-model.js';
import type {
    DashboardStructureExplorerAction,
    DashboardStructureExplorerEntityKey,
    DashboardStructureExplorerSnapshot,
} from './dashboard-structure-explorer-model.js';

describe('buildDashboardStructureExplorerModel', () => {
    it('builds root hierarchy with normalized role and channel ordering', () => {
        const model = buildDashboardStructureExplorerModel({ snapshot: createSnapshot() });

        expect(model.paths).toContain('Roles/');
        expect(model.paths).toContain('Categories/');
        expect(model.paths).toContain('Uncategorized Channels/');
        expect(model.preparedInput.paths).not.toContain('Roles/');
        expect(model.preparedInput.paths).not.toContain('Categories/');
        expect(model.preparedInput.paths).not.toContain('Uncategorized Channels/');
        expect(model.preparedInput.paths.every((path) => !path.includes('['))).toBe(true);
        expect(indexOfEntity(model, 'role:role-admin')).toBeLessThan(indexOfEntity(model, 'role:role-member'));
        expect(indexOfEntity(model, 'role:role-member')).toBeLessThan(indexOfEntity(model, 'role:guild-1'));
        expect(indexOfEntity(model, 'channel:channel-general')).toBeLessThan(
            indexOfEntity(model, 'channel:channel-updates')
        );
        expect(model.pathMetadata.get(pathForEntity(model, 'role:role-admin'))?.label).toBe('Admin');
    });

    it('places channels under categories or uncategorized fallback', () => {
        const model = buildDashboardStructureExplorerModel({ snapshot: createSnapshot() });

        expect(model.pathMetadata.get(pathForEntity(model, 'channel:channel-general'))).toMatchObject({
            entityKey: 'channel:channel-general',
            kind: 'channel',
            label: 'general',
            parentId: 'category-general',
        });
        expect(model.pathMetadata.get(pathForEntity(model, 'channel:channel-lobby'))).toMatchObject({
            entityKey: 'channel:channel-lobby',
            kind: 'channel',
            label: 'lobby',
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

        expect(model.pathMetadata.get(pathForEntity(model, 'channel:channel-lobby'))?.badges).toEqual(
            expect.arrayContaining(['move', 'permissions', 'update'])
        );
        expect(model.pathMetadata.get(pathForEntity(model, 'channel:channel-general'))?.badges).toEqual(
            expect.arrayContaining(['blocked', 'unsupported'])
        );
        expect(model.pathMetadata.get(pathForEntity(model, 'channel:channel-new'))?.badges).toEqual(
            expect.arrayContaining(['create', 'failed', 'retry'])
        );
        expect(model.paths.some((path) => model.pathMetadata.get(path)?.kind === 'action')).toBe(true);
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

        expect(model.pathMetadata.get(pathForEntity(model, 'role:role-member'))?.badges).toContain('move');
        expect(model.pathMetadata.get(pathForEntity(model, 'role:role-member'))?.badges).not.toContain('blocked');
        expect(model.pathMetadata.get(pathForEntity(model, 'role:guild-1'))?.badges).toEqual(
            expect.arrayContaining(['blocked', 'unsupported'])
        );
        expect(model.pathMetadata.get(pathForEntity(model, 'role:guild-1'))?.risks).toContain(
            '@everyone cannot be moved.'
        );
    });

    it('keeps unsafe names from breaking tree paths', () => {
        const model = buildDashboardStructureExplorerModel({
            snapshot: {
                ...createSnapshot(),
                categories: [{ ...createSnapshot().categories[0], name: 'Ops/Live\u0000' }],
                channels: [{ ...createSnapshot().channels[0], name: '' }],
            },
        });

        expect(model.pathMetadata.get(pathForEntity(model, 'category:category-general'))?.label).toBe('Ops Live');
        expect(model.pathMetadata.get(pathForEntity(model, 'channel:channel-updates'))?.label).toBe('Unnamed');
    });

    it('keeps duplicate display names unique without exposing ids', () => {
        const model = buildDashboardStructureExplorerModel({
            snapshot: {
                ...createSnapshot(),
                roles: [
                    { ...createSnapshot().roles[0], id: 'role-a', name: 'Member' },
                    { ...createSnapshot().roles[1], id: 'role-b', name: 'Member' },
                ],
            },
        });

        expect(pathForEntity(model, 'role:role-a')).toBe('Roles/Member (2)');
        expect(pathForEntity(model, 'role:role-b')).toBe('Roles/Member');
        expect(model.preparedInput.paths.every((path) => !path.includes('role-a') && !path.includes('role-b'))).toBe(
            true
        );
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

        expect(model.pathMetadata.get(pathForEntity(model, 'role:role-member'))?.badges).toEqual(
            expect.arrayContaining(['delete', 'destructive'])
        );
        expect(model.pathMetadata.get(pathForEntity(model, 'role:role-member'))?.risks).toContain(
            'Delete approval required.'
        );
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

function indexOfEntity(
    model: ReturnType<typeof buildDashboardStructureExplorerModel>,
    entityKey: DashboardStructureExplorerEntityKey
): number {
    return indexOfPath(model, pathForEntity(model, entityKey));
}

function pathForEntity(
    model: ReturnType<typeof buildDashboardStructureExplorerModel>,
    entityKey: DashboardStructureExplorerEntityKey
): string {
    const path = model.entityPathByKey.get(entityKey);
    expect(path).toBeTruthy();
    return path ?? '';
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
