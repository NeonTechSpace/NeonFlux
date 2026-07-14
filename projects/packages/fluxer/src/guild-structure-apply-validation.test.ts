import { describe, expect, it } from 'vitest';

import {
    deriveBlueprintCursorAuthority,
    validateBlueprintActionReferences,
} from '@neonflux/blueprint/action-authority';

describe('structure apply reference validation', () => {
    it('blocks the whole batch when a later order action has an unresolved source identity', () => {
        const result = validateBlueprintActionReferences({
            guildId: 'target-guild',
            knownTargetKinds: { 'target-guild': 'role', 'target-role': 'role' },
            actions: [
                {
                    id: 'update-role',
                    actionType: 'update',
                    targetType: 'role',
                    targetId: 'target-role',
                    changes: [{ field: 'name', after: 'Verified' }],
                },
                {
                    id: 'channel-order',
                    actionType: 'update',
                    targetType: 'channel-order',
                    after: [{ sourceId: 'unmapped-source-channel', parentSourceId: null, position: 0 }],
                },
            ],
        });

        expect(result).toStrictEqual({
            ok: false,
            actionId: 'channel-order',
            errorType: 'structure-order-mapping-missing',
        });
    });

    it('allows later parent, role-overwrite, and order references owned by earlier creates', () => {
        const result = validateBlueprintActionReferences({
            guildId: 'target-guild',
            knownTargetKinds: { 'target-guild': 'role' },
            actions: [
                {
                    id: 'create-role',
                    actionType: 'create',
                    targetType: 'role',
                    targetId: 'source-role',
                    after: { name: 'Member', permissions: '0' },
                },
                {
                    id: 'create-category',
                    actionType: 'create',
                    targetType: 'category',
                    targetId: 'source-category',
                    after: { name: 'General', parentId: null, permissionOverwrites: [] },
                },
                {
                    id: 'create-channel',
                    actionType: 'create',
                    targetType: 'channel',
                    targetId: 'source-channel',
                    after: {
                        name: 'chat',
                        parentId: 'source-category',
                        permissionOverwrites: [],
                    },
                },
                {
                    id: 'set-channel-overwrite',
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'source-channel',
                    changes: [
                        {
                            field: 'permissionOverwrites',
                            before: [],
                            after: [{ id: 'source-role', type: 0, allow: '0', deny: '1' }],
                        },
                    ],
                },
                {
                    id: 'channel-order',
                    actionType: 'update',
                    targetType: 'channel-order',
                    after: [
                        { sourceId: 'source-category', parentSourceId: null, position: 0 },
                        { sourceId: 'source-channel', parentSourceId: 'source-category', position: 0 },
                    ],
                },
                {
                    id: 'role-order',
                    actionType: 'update',
                    targetType: 'role-order',
                    after: [{ sourceId: 'source-role', position: 1 }],
                },
            ],
        });

        expect(result).toStrictEqual({ ok: true });
    });

    it('rejects unknown direct targets and blank overwrite identities', () => {
        expect(
            validateBlueprintActionReferences({
                guildId: 'target-guild',
                knownTargetKinds: { 'target-guild': 'role' },
                actions: [
                    {
                        id: 'update-unknown',
                        actionType: 'update',
                        targetType: 'role',
                        targetId: 'unknown-target-role',
                    },
                ],
            })
        ).toStrictEqual({
            ok: false,
            actionId: 'update-unknown',
            errorType: 'structure-reference-mapping-missing',
            field: 'targetId',
        });

        expect(
            validateBlueprintActionReferences({
                guildId: 'target-guild',
                knownTargetKinds: { 'target-guild': 'role' },
                actions: [
                    {
                        id: 'create-channel',
                        actionType: 'create',
                        targetType: 'channel',
                        targetId: 'source-channel',
                        after: { permissionOverwrites: [{ id: '   ', type: 0 }] },
                    },
                ],
            })
        ).toStrictEqual({
            ok: false,
            actionId: 'create-channel',
            errorType: 'invalid-value',
            field: 'permissionOverwrites',
        });
    });

    it('treats the target guild id as the @everyone role for role overwrites', () => {
        expect(
            validateBlueprintActionReferences({
                actions: [
                    {
                        id: 'update-everyone-overwrite',
                        actionType: 'update',
                        targetType: 'channel',
                        targetId: 'target-channel',
                        changes: [
                            {
                                field: 'permissionOverwrites',
                                before: [],
                                after: [{ id: 'source-guild', type: 0, allow: '1', deny: '0' }],
                            },
                        ],
                    },
                ],
                guildId: 'target-guild',
                knownTargetKinds: { 'target-channel': 'channel', 'target-guild': 'role' },
                sourceGuildId: 'source-guild',
            })
        ).toStrictEqual({ ok: true });
    });

    it('replays delete then recreate of one source identity onto a distinct target id', () => {
        const actions = [
            {
                id: 'delete-channel',
                actionType: 'delete',
                targetType: 'channel',
                targetId: 'source-channel',
            },
            {
                id: 'recreate-channel',
                actionType: 'create',
                targetType: 'channel',
                targetId: 'source-channel',
                after: { name: 'chat', permissionOverwrites: [] },
            },
        ];

        expect(
            deriveBlueprintCursorAuthority({
                actions,
                cursor: 2,
                runIdMap: { 'source-channel': 'new-target-channel' },
                guildId: 'target-guild',
                initialIdMap: { 'source-channel': 'old-target-channel' },
                knownTargetKinds: { 'old-target-channel': 'channel', 'target-guild': 'role' },
            })
        ).toStrictEqual({
            idMap: { 'source-channel': 'new-target-channel' },
            knownTargetKinds: { 'target-guild': 'role', 'new-target-channel': 'channel' },
            ok: true,
        });
    });

    it('rejects a resumed suffix that references a target deleted by the completed prefix', () => {
        expect(
            deriveBlueprintCursorAuthority({
                actions: [
                    {
                        id: 'delete-channel',
                        actionType: 'delete',
                        targetType: 'channel',
                        targetId: 'source-channel',
                    },
                    {
                        id: 'update-deleted-channel',
                        actionType: 'update',
                        targetType: 'channel',
                        targetId: 'source-channel',
                        changes: [{ field: 'name', after: 'renamed' }],
                    },
                ],
                cursor: 1,
                runIdMap: { 'source-channel': 'target-channel' },
                guildId: 'target-guild',
                initialIdMap: { 'source-channel': 'target-channel' },
                knownTargetKinds: { 'target-channel': 'channel', 'target-guild': 'role' },
            })
        ).toStrictEqual({
            actionId: 'update-deleted-channel',
            errorType: 'structure-reference-mapping-missing',
            field: 'targetId',
            ok: false,
        });
    });
});
