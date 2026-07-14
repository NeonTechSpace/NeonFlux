import { describe, expect, it } from 'vitest';

import { buildBlueprintProviderSteps } from '@neonflux/blueprint/provider-steps';

describe('guild structure provider steps', () => {
    it('expands a channel create and its overwrites into deterministic single-request steps', () => {
        const steps = buildBlueprintProviderSteps(
            [
                {
                    actionType: 'create',
                    targetType: 'channel',
                    targetId: 'source-channel',
                    label: 'chat',
                    details: {
                        label: 'chat',
                        after: {
                            id: 'source-channel',
                            name: 'chat',
                            type: 0,
                            parentId: null,
                            position: 0,
                            permissionOverwrites: [
                                { id: 'role-b', type: 0, allow: '1', deny: '0' },
                                { id: 'role-a', type: 0, allow: '0', deny: '1' },
                            ],
                        },
                    },
                },
            ],
            'merge'
        );

        expect(steps).toHaveLength(3);
        expect(
            (steps[0]?.details as { after: { permissionOverwrites: unknown[] } }).after.permissionOverwrites
        ).toEqual([]);
        expect(steps.map((step) => (step.details.provider as { operation: string }).operation)).toEqual([
            'create',
            'permission-overwrite-upsert',
            'permission-overwrite-upsert',
        ]);
        expect(steps.map((step) => step.details.mutationSteps)).toEqual([1, 1, 1]);
        expect(
            steps.slice(1).map((step) => {
                const changes = (step.details as { changes: Array<{ after: Array<{ id: string }> }> }).changes;
                return changes[0]?.after[0]?.id;
            })
        ).toEqual(['role-a', 'role-b']);
        expect(steps.map((step) => step.details.provider)).toEqual([
            expect.objectContaining({ step: 1, stepCount: 3 }),
            expect.objectContaining({ step: 2, stepCount: 3 }),
            expect.objectContaining({ step: 3, stepCount: 3 }),
        ]);
    });

    it('splits mixed channel edits into one structural edit and one step per changed overwrite', () => {
        const steps = buildBlueprintProviderSteps(
            [
                {
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'target-channel',
                    label: 'chat',
                    details: {
                        label: 'chat',
                        changes: [
                            { field: 'name', before: 'old-chat', after: 'chat' },
                            { field: 'parentId', before: 'old-category', after: 'new-category' },
                            {
                                field: 'permissionOverwrites',
                                before: [
                                    { id: 'removed-role', type: 0, allow: '0', deny: '1' },
                                    { id: 'changed-role', type: 0, allow: '0', deny: '1' },
                                ],
                                after: [
                                    { id: 'changed-role', type: 0, allow: '1', deny: '0' },
                                    { id: 'added-user', type: 1, allow: '1', deny: '0' },
                                ],
                            },
                        ],
                    },
                },
            ],
            'merge'
        );

        expect(steps.map((step) => (step.details.provider as { operation: string }).operation)).toEqual([
            'update-metadata',
            'update-placement',
            'permission-overwrite-delete',
            'permission-overwrite-upsert',
            'permission-overwrite-upsert',
        ]);
        expect((steps[0]?.details as { changes: unknown[] }).changes).toEqual([
            { field: 'name', before: 'old-chat', after: 'chat' },
        ]);
        expect((steps[1]?.details as { changes: unknown[] }).changes).toEqual([
            { field: 'parentId', before: 'old-category', after: 'new-category' },
        ]);
        expect(steps.slice(1).map((step) => step.actionType)).toEqual(['update', 'update', 'update', 'update']);
    });
});
