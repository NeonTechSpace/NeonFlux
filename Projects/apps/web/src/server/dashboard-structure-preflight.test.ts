import { describe, expect, it } from 'vitest';

import { preflightDashboardStructureImportPlan } from './dashboard-structure-preflight.js';
import type { DashboardStructureSnapshot } from './dashboard-structure-diff.js';

describe('dashboard structure preflight', () => {
    it('marks supported unchanged channel-name updates ready', () => {
        const report = preflightDashboardStructureImportPlan(createSnapshot(), [
            {
                id: 'action-1',
                actionType: 'update',
                targetType: 'channel',
                targetId: 'channel-1',
                label: 'general',
                details: {
                    changes: [{ field: 'name', before: 'general', after: 'announcements' }],
                },
            },
        ]);

        expect(report.summary).toStrictEqual({
            total: 1,
            ready: 1,
            stale: 0,
            mappingRequired: 0,
            destructiveApprovalRequired: 0,
            unsupported: 0,
            invalidPlan: 0,
        });
        expect(report.actions[0]).toMatchObject({
            status: 'ready',
            message: 'The target still matches the dry-run baseline.',
        });
    });

    it('detects stale baselines before apply can be enabled', () => {
        const report = preflightDashboardStructureImportPlan(createSnapshot(), [
            {
                id: 'action-1',
                actionType: 'update',
                targetType: 'channel',
                targetId: 'channel-1',
                details: {
                    changes: [{ field: 'name', before: 'old-name', after: 'announcements' }],
                },
            },
        ]);

        expect(report.summary.stale).toBe(1);
        expect(report.actions[0]).toMatchObject({
            status: 'stale',
            message: 'Field name changed after the dry-run was created.',
        });
    });

    it('marks creates with resolvable parent mappings ready', () => {
        const report = preflightDashboardStructureImportPlan(createSnapshot(), [
            {
                id: 'create-category',
                actionType: 'create',
                targetType: 'category',
                targetId: 'source-category-2',
                details: {
                    after: {
                        id: 'source-category-2',
                        name: 'Projects',
                        type: 4,
                        parentId: null,
                        position: 2,
                        permissionOverwrites: [],
                    },
                },
            },
            {
                id: 'create-channel',
                actionType: 'create',
                targetType: 'channel',
                targetId: 'source-channel-2',
                details: {
                    after: {
                        id: 'source-channel-2',
                        name: 'planning',
                        type: 0,
                        parentId: 'source-category-2',
                        position: 3,
                        permissionOverwrites: [],
                    },
                },
            },
        ]);

        expect(report.summary).toMatchObject({
            ready: 2,
            mappingRequired: 0,
            unsupported: 0,
            invalidPlan: 0,
        });
        expect(report.actions.map((action) => action.status)).toStrictEqual(['ready', 'ready']);
        expect(report.actions[1]?.message).toContain('Position is tracked');
    });

    it('marks channel permission overwrite updates ready when targets resolve', () => {
        const report = preflightDashboardStructureImportPlan(createSnapshotWithChannelOverwrites(), [
            {
                id: 'update-overwrites',
                actionType: 'update',
                targetType: 'channel',
                targetId: 'channel-1',
                details: {
                    changes: [
                        {
                            field: 'permissionOverwrites',
                            before: [
                                {
                                    id: 'role-1',
                                    type: 0,
                                    allow: '0',
                                    deny: '1024',
                                },
                            ],
                            after: [
                                {
                                    id: 'role-1',
                                    type: 0,
                                    allow: '1024',
                                    deny: '0',
                                },
                                {
                                    id: 'user-1',
                                    type: 1,
                                    allow: '2048',
                                    deny: '0',
                                },
                            ],
                        },
                    ],
                },
            },
        ]);

        expect(report.summary).toMatchObject({
            ready: 1,
            mappingRequired: 0,
            invalidPlan: 0,
        });
    });

    it('marks role visual updates ready while leaving role position unsupported', () => {
        const report = preflightDashboardStructureImportPlan(createSnapshot(), [
            {
                id: 'role-visuals',
                actionType: 'update',
                targetType: 'role',
                targetId: 'role-1',
                details: {
                    changes: [
                        { field: 'name', before: 'Member', after: 'Moderator' },
                        { field: 'permissions', before: '0', after: '2048' },
                        { field: 'color', before: 0, after: 255 },
                        { field: 'hoist', before: false, after: true },
                        { field: 'mentionable', before: false, after: true },
                    ],
                },
            },
            {
                id: 'role-position',
                actionType: 'update',
                targetType: 'role',
                targetId: 'role-1',
                details: {
                    changes: [{ field: 'position', before: 1, after: 2 }],
                },
            },
        ]);

        expect(report.actions.map((action) => action.status)).toStrictEqual(['ready', 'unsupported']);
    });

    it('allows imported everyone overwrites when the source guild id is known', () => {
        const report = preflightDashboardStructureImportPlan(
            createSnapshot(),
            [
                {
                    id: 'create-channel',
                    actionType: 'create',
                    targetType: 'channel',
                    targetId: 'source-channel-1',
                    details: {
                        after: {
                            id: 'source-channel-1',
                            name: 'source-general',
                            type: 0,
                            parentId: null,
                            position: 3,
                            permissionOverwrites: [
                                {
                                    id: 'source-guild-1',
                                    type: 0,
                                    allow: '0',
                                    deny: '1024',
                                },
                            ],
                        },
                    },
                },
            ],
            { sourceGuildId: 'source-guild-1' }
        );

        expect(report.summary).toMatchObject({
            ready: 1,
            mappingRequired: 0,
            invalidPlan: 0,
        });
    });

    it('requires permission overwrite role targets to exist or be created by the same plan', () => {
        const report = preflightDashboardStructureImportPlan(createSnapshot(), [
            {
                id: 'create-role',
                actionType: 'create',
                targetType: 'role',
                targetId: 'source-role-1',
                details: {
                    after: {
                        id: 'source-role-1',
                        name: 'Imported',
                        position: 2,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                },
            },
            {
                id: 'create-channel',
                actionType: 'create',
                targetType: 'channel',
                targetId: 'source-channel-1',
                details: {
                    after: {
                        id: 'source-channel-1',
                        name: 'source-general',
                        type: 0,
                        parentId: null,
                        position: 3,
                        permissionOverwrites: [
                            {
                                id: 'source-role-1',
                                type: 0,
                                allow: '1024',
                                deny: '0',
                            },
                        ],
                    },
                },
            },
            {
                id: 'create-blocked-channel',
                actionType: 'create',
                targetType: 'channel',
                targetId: 'source-channel-2',
                details: {
                    after: {
                        id: 'source-channel-2',
                        name: 'blocked',
                        type: 0,
                        parentId: null,
                        position: 4,
                        permissionOverwrites: [
                            {
                                id: 'missing-role',
                                type: 0,
                                allow: '1024',
                                deny: '0',
                            },
                        ],
                    },
                },
            },
        ]);

        expect(report.actions.map((action) => action.status)).toStrictEqual(['ready', 'ready', 'mapping-required']);
        expect(report.summary).toMatchObject({
            ready: 2,
            mappingRequired: 1,
        });
    });

    it('blocks duplicate permission overwrites and overwrites for roles deleted by the same plan', () => {
        const report = preflightDashboardStructureImportPlan(createSnapshot(), [
            {
                id: 'delete-role',
                actionType: 'delete',
                targetType: 'role',
                targetId: 'role-1',
                details: { before: createSnapshot().roles[0] },
            },
            {
                id: 'duplicate-overwrites',
                actionType: 'create',
                targetType: 'channel',
                targetId: 'source-channel-1',
                details: {
                    after: {
                        id: 'source-channel-1',
                        name: 'duplicate',
                        type: 0,
                        parentId: null,
                        position: 3,
                        permissionOverwrites: [
                            {
                                id: 'role-1',
                                type: 0,
                                allow: '0',
                                deny: '1024',
                            },
                            {
                                id: 'role-1',
                                type: 0,
                                allow: '1024',
                                deny: '0',
                            },
                        ],
                    },
                },
            },
            {
                id: 'deleted-role-overwrite',
                actionType: 'create',
                targetType: 'channel',
                targetId: 'source-channel-2',
                details: {
                    after: {
                        id: 'source-channel-2',
                        name: 'deleted-role',
                        type: 0,
                        parentId: null,
                        position: 4,
                        permissionOverwrites: [
                            {
                                id: 'role-1',
                                type: 0,
                                allow: '1024',
                                deny: '0',
                            },
                        ],
                    },
                },
            },
        ]);

        expect(report.actions.map((action) => action.status)).toStrictEqual([
            'destructive-approval-required',
            'invalid-plan',
            'invalid-plan',
        ]);
    });

    it('separates mapping, destructive, unsupported, and invalid blockers', () => {
        const report = preflightDashboardStructureImportPlan(createSnapshot(), [
            {
                id: 'create-1',
                actionType: 'create',
                targetType: 'channel',
                targetId: 'channel-new',
                details: {
                    after: {
                        id: 'channel-new',
                        name: 'New',
                        type: 0,
                        parentId: 'missing-category',
                        position: 2,
                        permissionOverwrites: [],
                    },
                },
            },
            {
                id: 'delete-1',
                actionType: 'delete',
                targetType: 'channel',
                targetId: 'channel-1',
                details: { before: createSnapshot().channels[0] },
            },
            {
                id: 'unsupported-1',
                actionType: 'update',
                targetType: 'channel',
                targetId: 'channel-1',
                details: {
                    changes: [{ field: 'parentId', before: null, after: 'category-1' }],
                },
            },
            {
                id: 'invalid-1',
                actionType: 'move',
                targetType: 'channel',
                targetId: 'channel-1',
                details: {},
            },
        ]);

        expect(report.summary).toMatchObject({
            mappingRequired: 1,
            destructiveApprovalRequired: 1,
            unsupported: 1,
            invalidPlan: 1,
        });
        expect(report.actions.map((action) => action.status)).toStrictEqual([
            'mapping-required',
            'destructive-approval-required',
            'unsupported',
            'invalid-plan',
        ]);
    });

    it('marks unchanged deletes ready only when destructive deletes are explicitly allowed', () => {
        const report = preflightDashboardStructureImportPlan(
            createSnapshot(),
            [
                {
                    id: 'delete-1',
                    actionType: 'delete',
                    targetType: 'channel',
                    targetId: 'channel-1',
                    details: { before: createSnapshot().channels[0] },
                },
            ],
            { allowDestructiveDeletes: true }
        );

        expect(report.summary).toMatchObject({
            ready: 1,
            destructiveApprovalRequired: 0,
        });
        expect(report.actions[0]).toMatchObject({
            status: 'ready',
            message: 'The target can be deleted after destructive approval.',
        });
    });
});

function createSnapshot(): DashboardStructureSnapshot {
    return {
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
        categories: [
            {
                id: 'category-1',
                name: 'Info',
                type: 4,
                parentId: null,
                position: 0,
                permissionOverwrites: [],
            },
        ],
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
    };
}

function createSnapshotWithChannelOverwrites(): DashboardStructureSnapshot {
    return {
        ...createSnapshot(),
        channels: [
            {
                id: 'channel-1',
                name: 'general',
                type: 0,
                parentId: null,
                position: 1,
                permissionOverwrites: [
                    {
                        id: 'role-1',
                        type: 0,
                        allow: '0',
                        deny: '1024',
                    },
                ],
            },
        ],
    };
}
