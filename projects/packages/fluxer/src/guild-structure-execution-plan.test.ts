import { describe, expect, it } from 'vitest';

import { buildFluxerGuildStructureExecutionActions } from './guild-structure-execution-plan.js';

describe('guild structure execution plan', () => {
    it('expands a channel create and its overwrites into deterministic single-request steps', () => {
        const actions = buildFluxerGuildStructureExecutionActions(
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

        expect(actions).toHaveLength(3);
        expect((actions[0]?.details.after as { permissionOverwrites: unknown[] }).permissionOverwrites).toEqual([]);
        expect(actions.map((action) => (action.details.execution as { operation: string }).operation)).toEqual([
            'create',
            'permission-overwrite-upsert',
            'permission-overwrite-upsert',
        ]);
        expect(actions.map((action) => action.details.mutationSteps)).toEqual([1, 1, 1]);
        expect(
            actions.slice(1).map((action) => {
                const changes = action.details.changes as Array<{ after: Array<{ id: string }> }>;
                return changes[0]?.after[0]?.id;
            })
        ).toEqual(['role-a', 'role-b']);
        expect(actions.map((action) => action.details.execution)).toEqual([
            expect.objectContaining({ step: 1, stepCount: 3 }),
            expect.objectContaining({ step: 2, stepCount: 3 }),
            expect.objectContaining({ step: 3, stepCount: 3 }),
        ]);
    });

    it('splits mixed channel edits into one structural edit and one step per changed overwrite', () => {
        const actions = buildFluxerGuildStructureExecutionActions(
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

        expect(actions.map((action) => (action.details.execution as { operation: string }).operation)).toEqual([
            'update-metadata',
            'update-placement',
            'permission-overwrite-delete',
            'permission-overwrite-upsert',
            'permission-overwrite-upsert',
        ]);
        expect(actions[0]?.details.changes).toEqual([{ field: 'name', before: 'old-chat', after: 'chat' }]);
        expect(actions[1]?.details.changes).toEqual([
            { field: 'parentId', before: 'old-category', after: 'new-category' },
        ]);
        expect(actions.slice(1).map((action) => action.actionType)).toEqual(['update', 'update', 'update', 'update']);
    });
});
