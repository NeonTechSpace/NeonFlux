import { describe, expect, it } from 'vitest';

import { diffDashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import type { DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import {
    isDashboardBlueprintPreflightReady,
    preflightDashboardBlueprintPlan,
} from './dashboard-blueprint-preflight.js';
import type { DashboardBlueprintPreflightInputPlanStep } from './dashboard-blueprint-preflight.js';

describe('Server Blueprint action preflight', () => {
    it('reports an empty approved plan as ready', () => {
        expect(preflightDashboardBlueprintPlan(createSnapshot(), [], { policy: 'synchronize' }).summary).toEqual({
            total: 0,
            ready: 0,
            stale: 0,
            mappingRequired: 0,
            destructiveApprovalRequired: 0,
            unsupported: 0,
            invalidPlan: 0,
        });
    });

    it('fails closed for an invalid planned action', () => {
        const report = preflightDashboardBlueprintPlan(
            createSnapshot(),
            [{ id: 'action-1', actionType: 'teleport', targetType: 'channel', targetId: 'channel-1', details: {} }],
            { policy: 'merge' }
        );
        expect(report.summary.invalidPlan).toBe(1);
        expect(report.steps[0]?.status).toBe('invalid-plan');
    });

    it('treats a delete-only safety check as ready for separate destructive approval', () => {
        expect(
            isDashboardBlueprintPreflightReady({
                summary: {
                    total: 1,
                    ready: 0,
                    stale: 0,
                    mappingRequired: 0,
                    destructiveApprovalRequired: 1,
                    unsupported: 0,
                    invalidPlan: 0,
                },
                steps: [],
            })
        ).toBe(true);
    });

    it('accepts retained Merge categories and channels through explicit destination authority', () => {
        const current = createSnapshot({
            guildId: 'target-guild',
            categories: [
                createChannel('retained-category', 'Retained', 4, null, 0),
                createChannel('target-category', 'Imported', 4, null, 1),
            ],
            channels: [
                createChannel('retained-channel', 'retained', 0, 'retained-category', 0),
                createChannel('target-channel', 'imported', 0, 'target-category', 0),
            ],
        });
        const report = preflightDashboardBlueprintPlan(current, [createRetainedMergeOrderAction()], {
            idMap: {
                'source-category': 'target-category',
                'source-channel': 'target-channel',
            },
            knownTargetIds: [
                'retained-category',
                'retained-channel',
                'target-category',
                'target-channel',
                'target-guild',
            ],
            policy: 'merge',
            sourceGuildId: 'source-guild',
            sourceIds: ['source-category', 'source-channel'],
        });

        expect(report.steps[0]).toMatchObject({ status: 'ready' });
    });

    it('validates a same-server rebuild baseline in destination space before recreating matching IDs', () => {
        const current = createSnapshot({
            categories: [createChannel('category-1', 'Category', 4, null, 0)],
            channels: [createChannel('channel-1', 'channel', 0, 'category-1', 0)],
        });
        const report = preflightDashboardBlueprintPlan(
            current,
            [
                createRebuildCreateAction('category', createChannel('category-1', 'Category', 4, null, 0)),
                createRebuildCreateAction('channel', createChannel('channel-1', 'channel', 0, 'category-1', 0)),
                {
                    id: 'channel-order',
                    actionType: 'update',
                    targetType: 'channel-order',
                    targetId: 'channel-order',
                    details: {
                        before: [
                            { sourceId: 'category-1', parentSourceId: null, position: 0 },
                            { sourceId: 'channel-1', parentSourceId: 'category-1', position: 0 },
                        ],
                        after: [
                            { sourceId: 'category-1', parentSourceId: null, position: 0 },
                            { sourceId: 'channel-1', parentSourceId: 'category-1', position: 0 },
                        ],
                    },
                },
            ],
            {
                idMap: {},
                knownTargetIds: ['category-1', 'channel-1', 'guild-1'],
                policy: 'rebuild',
                sourceGuildId: 'guild-1',
                sourceIds: ['category-1', 'channel-1'],
            }
        );

        expect(report.steps[2]).toMatchObject({ status: 'ready' });
    });

    it('accepts overwrite steps that follow a planned channel create in a cross-guild rebuild', () => {
        const current = createSnapshot({
            guildId: 'target-guild',
            channels: [createChannel('target-channel', 'old-channel', 0, null, 0)],
        });
        const requested = createSnapshot({
            guildId: 'source-guild',
            roles: [createRole('source-role')],
            channels: [
                {
                    ...createChannel('source-channel', 'new-channel', 0, null, 0),
                    permissionOverwrites: [{ id: 'source-role', type: 0, allow: '1024', deny: '0' }],
                },
            ],
        });
        const { plan, report } = preflightRebuildPlan(current, requested);

        expect(
            plan.steps.some(
                (action) =>
                    action.actionType === 'update' &&
                    action.targetId === 'source-channel' &&
                    readProviderOperation(action.details) === 'permission-overwrite-upsert'
            )
        ).toBe(true);
        expect(report.summary).toMatchObject({
            stale: 0,
            mappingRequired: 0,
            unsupported: 0,
            invalidPlan: 0,
        });
    });

    it('accepts overwrite steps after recreating a same-ID channel in a rebuild', () => {
        const current = createSnapshot({
            guildId: 'same-guild',
            channels: [
                {
                    ...createChannel('channel-1', 'old-channel', 0, null, 0),
                    permissionOverwrites: [{ id: 'old-member', type: 1, allow: '0', deny: '1024' }],
                },
            ],
        });
        const requested = createSnapshot({
            guildId: 'same-guild',
            roles: [createRole('role-1')],
            channels: [
                {
                    ...createChannel('channel-1', 'new-channel', 0, null, 0),
                    permissionOverwrites: [{ id: 'role-1', type: 0, allow: '1024', deny: '0' }],
                },
            ],
        });
        const { report } = preflightRebuildPlan(current, requested);

        expect(report.summary).toMatchObject({
            stale: 0,
            mappingRequired: 0,
            unsupported: 0,
            invalidPlan: 0,
        });
    });

    it.each([
        {
            label: 'parent',
            action: createChannelAction({ parentId: 'unknown-category', permissionOverwrites: [] }),
        },
        {
            label: 'role overwrite',
            action: createChannelAction({
                parentId: null,
                permissionOverwrites: [{ id: 'current-but-untrusted-role', type: 0, allow: '0', deny: '0' }],
            }),
        },
    ])('blocks an unknown $label reference instead of accepting its raw ID', ({ action }) => {
        const current = createSnapshot({ roles: [createRole('current-but-untrusted-role')] });
        const report = preflightDashboardBlueprintPlan(current, [action], {
            knownTargetIds: ['guild-1'],
            policy: 'merge',
            sourceIds: ['source-channel'],
        });

        expect(report.steps[0]).toMatchObject({ status: 'mapping-required' });
    });

    it('blocks an unknown channel-order reference before enqueue', () => {
        const report = preflightDashboardBlueprintPlan(
            createSnapshot(),
            [
                {
                    id: 'order',
                    actionType: 'update',
                    targetType: 'channel-order',
                    targetId: 'channel-order',
                    details: {
                        after: [{ sourceId: 'unknown-channel', parentSourceId: null, position: 0 }],
                    },
                },
            ],
            { knownTargetIds: ['guild-1'], policy: 'merge' }
        );

        expect(report.steps[0]).toMatchObject({ status: 'mapping-required' });
    });

    it('maps the requested guild overwrite while preserving opaque member overwrite IDs', () => {
        const report = preflightDashboardBlueprintPlan(
            createSnapshot(),
            [
                createChannelAction({
                    parentId: null,
                    permissionOverwrites: [
                        { id: 'source-guild', type: 0, allow: '0', deny: '0' },
                        { id: 'member-not-in-structure-snapshot', type: 1, allow: '0', deny: '0' },
                    ],
                }),
            ],
            {
                knownTargetIds: ['guild-1'],
                policy: 'merge',
                sourceGuildId: 'source-guild',
                sourceIds: ['source-channel'],
            }
        );

        expect(report.steps[0]).toMatchObject({ status: 'ready' });
    });
});

function createSnapshot(overrides: Partial<DashboardBlueprintSnapshot> = {}): DashboardBlueprintSnapshot {
    return {
        version: 1,
        guildId: 'guild-1',
        guildName: 'Guild',
        roles: [],
        categories: [],
        channels: [],
        ...overrides,
    };
}

function createRole(id: string): DashboardBlueprintSnapshot['roles'][number] {
    return { id, name: id, position: 1, color: 0, permissions: '0', hoist: false, mentionable: false };
}

function createChannel(
    id: string,
    name: string,
    type: number,
    parentId: string | null,
    position: number
): DashboardBlueprintSnapshot['channels'][number] {
    return { id, name, type, parentId, position, permissionOverwrites: [] };
}

function createChannelAction(after: {
    parentId: string | null;
    permissionOverwrites: Array<{ id: string; type: number; allow: string; deny: string }>;
}): DashboardBlueprintPreflightInputPlanStep {
    return {
        id: 'create-channel',
        actionType: 'create',
        targetType: 'channel',
        targetId: 'source-channel',
        details: {
            after: {
                id: 'source-channel',
                name: 'channel',
                type: 0,
                position: 0,
                ...after,
            },
        },
    };
}

function createRebuildCreateAction(
    targetType: 'category' | 'channel',
    after: DashboardBlueprintSnapshot['channels'][number]
): DashboardBlueprintPreflightInputPlanStep {
    return {
        id: `create-${targetType}`,
        actionType: 'create',
        targetType,
        targetId: after.id,
        details: { after },
    };
}

function createRetainedMergeOrderAction(): DashboardBlueprintPreflightInputPlanStep {
    return {
        id: 'channel-order',
        actionType: 'update',
        targetType: 'channel-order',
        targetId: 'channel-order',
        details: {
            before: [
                { sourceId: 'retained-category', parentSourceId: null, position: 0 },
                { sourceId: 'target-category', parentSourceId: null, position: 1 },
                { sourceId: 'retained-channel', parentSourceId: 'retained-category', position: 0 },
                { sourceId: 'target-channel', parentSourceId: 'target-category', position: 0 },
            ],
            after: [
                { sourceId: 'source-category', parentSourceId: null, position: 0 },
                { sourceId: 'retained-category', parentSourceId: null, position: 1 },
                { sourceId: 'retained-channel', parentSourceId: 'retained-category', position: 0 },
                { sourceId: 'source-channel', parentSourceId: 'source-category', position: 0 },
            ],
        },
    };
}

function preflightRebuildPlan(current: DashboardBlueprintSnapshot, requested: DashboardBlueprintSnapshot) {
    const plan = diffDashboardBlueprintSnapshot(current, requested, { policy: 'rebuild' });
    const report = preflightDashboardBlueprintPlan(
        current,
        plan.steps.map((action, index) => ({ ...action, id: `action-${String(index)}` })),
        {
            idMap: Object.fromEntries(
                Object.entries(plan.sourceTargetMap).filter(
                    (entry): entry is [string, string] => typeof entry[1] === 'string'
                )
            ),
            knownTargetIds: Object.keys(plan.knownTargetKinds),
            policy: 'rebuild',
            ...(requested.guildId ? { sourceGuildId: requested.guildId } : {}),
            sourceIds: Object.keys(plan.sourceTargetMap),
        }
    );
    return { plan, report };
}

function readProviderOperation(details: Record<string, unknown>): unknown {
    const provider = details.provider;
    return typeof provider === 'object' && provider !== null && !Array.isArray(provider)
        ? (provider as Record<string, unknown>).operation
        : undefined;
}
