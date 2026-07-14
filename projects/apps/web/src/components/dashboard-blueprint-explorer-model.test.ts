import { describe, expect, it } from 'vitest';

import {
    buildDashboardBlueprintExplorerModel,
    parseDashboardBlueprintExplorerSnapshot,
    toDashboardBlueprintExplorerPlanSteps,
} from './dashboard-blueprint-explorer-model.js';
import type {
    DashboardBlueprintExplorerPlanStep,
    DashboardBlueprintExplorerEntityKey,
    DashboardBlueprintExplorerSnapshot,
} from './dashboard-blueprint-explorer-model.js';

describe('buildDashboardBlueprintExplorerModel', () => {
    it('builds root hierarchy with normalized role and channel ordering', () => {
        const channelModel = buildDashboardBlueprintExplorerModel({ section: 'channels', snapshot: createSnapshot() });
        const roleModel = buildDashboardBlueprintExplorerModel({ section: 'roles', snapshot: createSnapshot() });

        expect(roleModel.paths).toContain('Roles/');
        expect(roleModel.paths).not.toContain('Categories/');
        expect(channelModel.paths).not.toContain('Roles/');
        expect(channelModel.paths).not.toContain('Categories/');
        expect(channelModel.paths).toContain('Uncategorized/');
        expect(channelModel.paths).toContain('General/');
        expect(roleModel.preparedInput.paths).not.toContain('Roles/');
        expect(channelModel.preparedInput.paths).not.toContain('Categories/');
        expect(channelModel.preparedInput.paths).not.toContain('Uncategorized/');
        expect(channelModel.preparedInput.paths[0]).toBe('Uncategorized/lobby');
        expect(channelModel.preparedInput.paths.every((path) => !path.includes('['))).toBe(true);
        expect(indexOfPath(channelModel, 'Uncategorized/')).toBeLessThan(indexOfPath(channelModel, 'General/'));
        expect(indexOfEntity(roleModel, 'role:role-admin')).toBeLessThan(indexOfEntity(roleModel, 'role:role-member'));
        expect(indexOfEntity(roleModel, 'role:role-member')).toBeLessThan(indexOfEntity(roleModel, 'role:guild-1'));
        expect(indexOfEntity(channelModel, 'channel:channel-general')).toBeLessThan(
            indexOfEntity(channelModel, 'channel:channel-updates')
        );
        expect(roleModel.pathMetadata.get(pathForEntity(roleModel, 'role:role-admin'))?.label).toBe('Admin');
    });

    it('places channels under categories or uncategorized fallback', () => {
        const model = buildDashboardBlueprintExplorerModel({ section: 'channels', snapshot: createSnapshot() });

        expect(pathForEntity(model, 'category:category-general')).toBe('General/');
        expect(pathForEntity(model, 'channel:channel-general')).toBe('General/general');
        expect(pathForEntity(model, 'channel:channel-lobby')).toBe('Uncategorized/lobby');
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

    it('uses action item parents to keep deleted channels under deleted categories', () => {
        const deletedCategory = {
            ...createSnapshot().categories[0],
            id: 'category-archive',
            name: 'Archive',
            position: 2,
        };
        const deletedChannel = {
            ...createSnapshot().channels[0],
            id: 'channel-old-updates',
            name: 'old-updates',
            parentId: deletedCategory.id,
        };
        const model = buildDashboardBlueprintExplorerModel({
            actions: [
                createAction({
                    actionType: 'delete',
                    details: { before: deletedChannel },
                    id: 'delete-channel',
                    label: deletedChannel.name,
                    targetId: deletedChannel.id,
                    targetType: 'channel',
                }),
                createAction({
                    actionType: 'delete',
                    details: { before: deletedCategory },
                    id: 'delete-category',
                    label: deletedCategory.name,
                    targetId: deletedCategory.id,
                    targetType: 'category',
                }),
            ],
            section: 'channels',
            snapshot: { ...createSnapshot(), categories: [], channels: [] },
        });

        expect(pathForEntity(model, 'category:category-archive')).toBe('Archive/');
        expect(pathForEntity(model, 'channel:channel-old-updates')).toBe('Archive/old-updates');
        expect(model.pathMetadata.get(pathForEntity(model, 'channel:channel-old-updates'))).toMatchObject({
            parentId: 'category-archive',
        });
    });

    it('does not fabricate entities for an empty channels snapshot', () => {
        const model = buildDashboardBlueprintExplorerModel({
            section: 'channels',
            snapshot: { ...createSnapshot(), categories: [], channels: [] },
        });

        expect(model.entityPathByKey.size).toBe(0);
        expect(model.preparedInput.paths).toEqual([]);
        expect(model.defaultSelectedPath).toBeUndefined();
    });

    it('attaches action, move, permission, blocked, failed, and retry badges', () => {
        const actions: DashboardBlueprintExplorerPlanStep[] = [
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
        const model = buildDashboardBlueprintExplorerModel({
            actions,
            section: 'channels',
            snapshot: createSnapshot(),
        });

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
        const model = buildDashboardBlueprintExplorerModel({
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
            section: 'roles',
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
        const model = buildDashboardBlueprintExplorerModel({
            section: 'channels',
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
        const model = buildDashboardBlueprintExplorerModel({
            section: 'roles',
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

    it('keeps a real Uncategorized category distinct from the fallback folder', () => {
        const model = buildDashboardBlueprintExplorerModel({
            section: 'channels',
            snapshot: {
                ...createSnapshot(),
                categories: [{ ...createSnapshot().categories[0], name: 'Uncategorized' }],
            },
        });

        expect(pathForEntity(model, 'category:category-general')).toBe('Uncategorized (2)/');
        expect(pathForEntity(model, 'channel:channel-general')).toBe('Uncategorized (2)/general');
        expect(pathForEntity(model, 'channel:channel-lobby')).toBe('Uncategorized/lobby');
    });

    it('keeps real categories distinct from the blocked-action shortcut', () => {
        const model = buildDashboardBlueprintExplorerModel({
            actions: [
                createAction({
                    actionType: 'update',
                    details: { changes: [{ field: 'type', before: 0, after: 5 }] },
                    targetId: 'channel-general',
                    targetType: 'channel',
                }),
            ],
            section: 'channels',
            snapshot: {
                ...createSnapshot(),
                categories: [{ ...createSnapshot().categories[0], name: 'Blocked / Unsupported' }],
            },
        });

        expect(pathForEntity(model, 'category:category-general')).toBe('Blocked Unsupported (2)/');
        expect(model.paths).toContain('Blocked / Unsupported/');
    });

    it('converts drift/import changes and attaches preflight statuses', () => {
        const actions = toDashboardBlueprintExplorerPlanSteps(
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
                steps: [
                    {
                        planStepId: 'action-1',
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
        const model = buildDashboardBlueprintExplorerModel({ actions, section: 'roles', snapshot: createSnapshot() });

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

        expect(parseDashboardBlueprintExplorerSnapshot(JSON.stringify(createSnapshot()))).toMatchObject({
            guildName: 'Guild 1',
            roles: expect.any(Array),
        });
        expect(parseDashboardBlueprintExplorerSnapshot(JSON.stringify(snapshotWithoutGuildName))).toMatchObject({
            guildId: 'guild-1',
            roles: expect.any(Array),
        });
        expect(
            parseDashboardBlueprintExplorerSnapshot(JSON.stringify({ ...createSnapshot(), guildName: '  Renamed  ' }))
        ).toMatchObject({
            guildName: 'Renamed',
        });
        expect(parseDashboardBlueprintExplorerSnapshot('{')).toBeUndefined();
        expect(parseDashboardBlueprintExplorerSnapshot('{"roles":[]}')).toBeUndefined();
    });
});

function indexOfPath(model: ReturnType<typeof buildDashboardBlueprintExplorerModel>, path: string): number {
    const index = model.paths.indexOf(path);
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
}

function indexOfEntity(
    model: ReturnType<typeof buildDashboardBlueprintExplorerModel>,
    entityKey: DashboardBlueprintExplorerEntityKey
): number {
    return indexOfPath(model, pathForEntity(model, entityKey));
}

function pathForEntity(
    model: ReturnType<typeof buildDashboardBlueprintExplorerModel>,
    entityKey: DashboardBlueprintExplorerEntityKey
): string {
    const path = model.entityPathByKey.get(entityKey);
    expect(path).toBeTruthy();
    return path ?? '';
}

function createAction(overrides: Partial<DashboardBlueprintExplorerPlanStep> = {}): DashboardBlueprintExplorerPlanStep {
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

function createSnapshot(): DashboardBlueprintExplorerSnapshot {
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
