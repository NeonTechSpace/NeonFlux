import { describe, expect, it } from 'vitest';

import {
    diffFluxerGuildStructureSnapshot,
    FluxerGuildStructureAmbiguousIdentityError,
    FluxerGuildStructureInvalidIdentityMappingError,
    normalizeFluxerGuildStructureSnapshot,
    toFluxerGuildStructureSnapshot,
} from './guild-structure-diff.js';

describe('guild structure diff', () => {
    it('normalizes a Fluxer-compatible structure snapshot', () => {
        const result = normalizeFluxerGuildStructureSnapshot({
            guildId: ' guild-1 ',
            guildName: ' Guild 1 ',
            botHighestRolePosition: 6,
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
                    url: 'https://example.com/general',
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
                botHighestRolePosition: 6,
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
                        url: 'https://example.com/general',
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
            normalizeFluxerGuildStructureSnapshot({
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
            normalizeFluxerGuildStructureSnapshot({
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
    });

    it('rejects malformed structure snapshots', () => {
        expect(
            normalizeFluxerGuildStructureSnapshot({
                roles: [],
                categories: [],
                channels: [{ id: 'channel-1' }],
            })
        ).toMatchObject({ type: 'invalid' });
    });

    it('rejects duplicate object and permission overwrite identities', () => {
        const duplicateObject = normalizeFluxerGuildStructureSnapshot({
            guildId: 'guild-1',
            roles: [
                {
                    id: 'duplicate-id',
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
                    id: 'duplicate-id',
                    name: 'general',
                    type: 0,
                    parentId: null,
                    position: 1,
                    permissionOverwrites: [],
                },
            ],
        });
        const duplicateOverwrite = normalizeFluxerGuildStructureSnapshot({
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
                    permissionOverwrites: [
                        { id: 'role-1', type: 0, allow: '1', deny: '0' },
                        { id: 'role-1', type: 0, allow: '0', deny: '1' },
                    ],
                },
            ],
        });

        expect(duplicateObject.type).toBe('invalid');
        expect(duplicateOverwrite.type).toBe('invalid');

        if (duplicateObject.type !== 'invalid' || duplicateOverwrite.type !== 'invalid') {
            throw new Error('Expected duplicate identities to be rejected');
        }

        expect(duplicateObject.message).toContain('duplicate-id');
        expect(duplicateOverwrite.message).toContain('0:role-1');
    });

    it('fails closed instead of guessing between ambiguous same-name matches', () => {
        const createRole = (id: string, name: string, position: number) => ({
            id,
            name,
            position,
            color: 0,
            permissions: '0',
            hoist: false,
            mentionable: false,
        });
        const current = toFluxerGuildStructureSnapshot({
            guildId: 'target-guild',
            guildName: 'Target Guild',
            roles: [
                createRole('role-current-1', 'Member', 3),
                createRole('role-current-anchor', 'Anchor', 2),
                createRole('role-current-2', 'Member', 1),
            ],
            categories: [],
            channels: [],
        });
        const requested = toFluxerGuildStructureSnapshot({
            guildId: 'source-guild',
            guildName: 'Source Guild',
            roles: [
                createRole('role-source-top', 'Top', 3),
                createRole('role-source', 'Member', 2),
                createRole('role-source-bottom', 'Bottom', 1),
            ],
            categories: [],
            channels: [],
        });

        let thrown: unknown;
        try {
            diffFluxerGuildStructureSnapshot(current, requested, { policy: 'synchronize' });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(FluxerGuildStructureAmbiguousIdentityError);
        expect((thrown as FluxerGuildStructureAmbiguousIdentityError).conflicts).toStrictEqual([
            {
                targetType: 'role',
                name: 'Member',
                sourceIds: ['role-source'],
                candidateTargetIds: ['role-current-1', 'role-current-2'],
            },
        ]);
    });

    it('globally assigns an exact-shape role instead of consuming it with an earlier fallback', () => {
        const createMemberRole = (id: string, permissions: string) => ({
            id,
            name: 'Member',
            position: 1,
            color: 0,
            permissions,
            hoist: false,
            mentionable: false,
        });
        const current = toFluxerGuildStructureSnapshot({
            guildId: 'target-guild',
            guildName: 'Target Guild',
            roles: [createMemberRole('role-current', '2')],
            categories: [],
            channels: [],
        });
        const requested = toFluxerGuildStructureSnapshot({
            guildId: 'source-guild',
            guildName: 'Source Guild',
            roles: [createMemberRole('role-fallback', '1'), createMemberRole('role-exact', '2')],
            categories: [],
            channels: [],
        });

        expect(
            diffFluxerGuildStructureSnapshot(current, requested, { policy: 'synchronize' }).sourceTargetMap
        ).toStrictEqual({
            'role-exact': 'role-current',
            'role-fallback': null,
        });
    });

    it('rejects missing parent categories and role overwrite targets', () => {
        const missingParent = normalizeFluxerGuildStructureSnapshot({
            guildId: 'guild-1',
            roles: [],
            categories: [],
            channels: [
                {
                    id: 'channel-1',
                    name: 'general',
                    type: 0,
                    parentId: 'missing-category',
                    position: 1,
                    permissionOverwrites: [],
                },
            ],
        });
        const missingRole = normalizeFluxerGuildStructureSnapshot({
            guildId: 'guild-1',
            roles: [],
            categories: [],
            channels: [
                {
                    id: 'channel-1',
                    name: 'general',
                    type: 0,
                    parentId: null,
                    position: 1,
                    permissionOverwrites: [{ id: 'missing-role', type: 0, allow: '1', deny: '0' }],
                },
            ],
        });

        expect(missingParent.type).toBe('invalid');
        expect(missingRole.type).toBe('invalid');

        if (missingParent.type !== 'invalid' || missingRole.type !== 'invalid') {
            throw new Error('Expected missing structure references to be rejected');
        }

        expect(missingParent.message).toContain('missing-category');
        expect(missingRole.message).toContain('missing-role');
    });

    it('plans creates, updates, deletes, and permission changes against the current server layout', () => {
        const current = toFluxerGuildStructureSnapshot(
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
        const currentRole = current.roles[0];
        const currentChannel = current.channels[0];
        if (!currentRole || !currentChannel) throw new Error('fixture-invalid');

        const requested = {
            ...current,
            roles: [
                {
                    ...currentRole,
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
            channels: [
                {
                    ...currentChannel,
                    permissionOverwrites: [{ id: 'role-1', type: 0, allow: '1', deny: '0' }],
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested, { policy: 'synchronize' });

        expect(plan.summary).toStrictEqual({
            creates: 1,
            updates: 3,
            deletes: 1,
            roles: 4,
            categories: 0,
            channels: 1,
        });
        expect(plan.actions.map((action) => [action.actionType, action.targetType, action.targetId])).toStrictEqual([
            ['update', 'role', 'role-1'],
            ['create', 'role', 'role-new'],
            ['delete', 'role', 'role-stale'],
            ['update', 'channel', 'channel-1'],
            ['update', 'role-order', 'role-order'],
        ]);
        expect(plan.actions.find((action) => action.targetType === 'channel')?.details).toMatchObject({
            changes: [
                {
                    field: 'permissionOverwrites',
                    before: [],
                    after: [{ id: 'role-1', type: 0, allow: '1', deny: '0' }],
                },
            ],
        });
    });

    it('ignores protected roles when planning imports', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'guild-1',
                guildName: 'Guild 1',
                roles: [
                    {
                        id: 'guild-1',
                        name: '@everyone',
                        position: 0,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                    {
                        id: 'bot-role-current',
                        name: 'Bot',
                        position: 10,
                        color: 0,
                        permissions: '0',
                        hoist: true,
                        mentionable: false,
                        protected: true,
                        protectionReason: 'bot',
                    },
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
                channels: [],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const requested = {
            ...current,
            guildId: 'source-guild',
            roles: [
                {
                    id: 'source-guild',
                    name: '@everyone',
                    position: 0,
                    color: 0,
                    permissions: '8',
                    hoist: false,
                    mentionable: false,
                },
                {
                    id: 'bot-role-requested',
                    name: 'Imported Bot',
                    position: 11,
                    color: 0,
                    permissions: '0',
                    hoist: true,
                    mentionable: false,
                    protected: true as const,
                    protectionReason: 'integration' as const,
                },
                {
                    id: 'role-1',
                    name: 'Members',
                    position: 1,
                    color: 0,
                    permissions: '0',
                    hoist: false,
                    mentionable: false,
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested, { policy: 'synchronize' });

        expect(plan.actions).toStrictEqual([
            {
                actionType: 'update',
                targetType: 'role',
                targetId: 'role-1',
                label: 'Members',
                details: {
                    label: 'Members',
                    sourceId: 'role-1',
                    changes: [{ field: 'name', before: 'Member', after: 'Members' }],
                },
            },
        ]);
    });

    it('omits cross-guild protected role overwrites from merge and rebuild plans', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'target-guild',
                guildName: 'Target Guild',
                roles: [
                    {
                        id: 'target-guild',
                        name: '@everyone',
                        position: 0,
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
                        name: 'team',
                        type: 0,
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                ],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const currentChannel = current.channels[0];
        if (!currentChannel) throw new Error('fixture-invalid');

        const requested = {
            ...current,
            guildId: 'source-guild',
            roles: [
                {
                    id: 'source-guild',
                    name: '@everyone',
                    position: 0,
                    color: 0,
                    permissions: '0',
                    hoist: false,
                    mentionable: false,
                    protected: true as const,
                    protectionReason: 'everyone' as const,
                },
                {
                    id: 'source-bot-role',
                    name: 'Source Bot',
                    position: 1,
                    color: 0,
                    permissions: '0',
                    hoist: true,
                    mentionable: false,
                    protected: true as const,
                    protectionReason: 'bot' as const,
                },
            ],
            channels: [
                {
                    ...currentChannel,
                    permissionOverwrites: [
                        { id: 'source-guild', type: 0, allow: '0', deny: '1024' },
                        { id: 'source-bot-role', type: 0, allow: '1024', deny: '0' },
                        { id: 'source-member', type: 1, allow: '1024', deny: '0' },
                    ],
                },
            ],
        };
        const expectedMergeOverwrites = [
            { id: 'target-guild', type: 0, allow: '0', deny: '1024' },
            { id: 'source-member', type: 1, allow: '1024', deny: '0' },
        ];
        const expectedRebuildOverwrites = [
            { id: 'source-guild', type: 0, allow: '0', deny: '1024' },
            { id: 'source-member', type: 1, allow: '1024', deny: '0' },
        ];

        const mergePlan = diffFluxerGuildStructureSnapshot(current, requested, { policy: 'merge' });
        const rebuildPlan = diffFluxerGuildStructureSnapshot(current, requested, {
            policy: 'rebuild',
        });

        expect(mergePlan.actions.find((action) => action.targetType === 'channel')?.details).toMatchObject({
            changes: [{ field: 'permissionOverwrites', before: [], after: expectedMergeOverwrites }],
        });
        expect(
            rebuildPlan.actions.find((action) => action.actionType === 'create' && action.targetType === 'channel')
                ?.details
        ).toMatchObject({ after: { permissionOverwrites: expectedRebuildOverwrites } });
    });

    it('matches unique same-name roles instead of planning duplicate create and delete actions', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'target-guild',
                guildName: 'Target Guild',
                roles: [
                    {
                        id: 'target-member',
                        name: 'Member',
                        position: 1,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                ],
                categories: [],
                channels: [],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const requested = {
            ...current,
            guildId: 'source-guild',
            roles: [
                {
                    id: 'source-member',
                    name: 'Member',
                    position: 5,
                    color: 255,
                    permissions: '8',
                    hoist: true,
                    mentionable: true,
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested, { policy: 'synchronize' });

        expect(plan.summary).toStrictEqual({
            creates: 0,
            updates: 1,
            deletes: 0,
            roles: 1,
            categories: 0,
            channels: 0,
        });
        expect(plan.actions).toStrictEqual([
            {
                actionType: 'update',
                targetType: 'role',
                targetId: 'target-member',
                label: 'Member',
                details: {
                    label: 'Member',
                    sourceId: 'source-member',
                    changes: [
                        { field: 'color', before: 0, after: 255 },
                        { field: 'permissions', before: '0', after: '8' },
                        { field: 'hoist', before: false, after: true },
                        { field: 'mentionable', before: false, after: true },
                    ],
                },
            },
        ]);
        expect(plan.sourceTargetMap).toStrictEqual({ 'source-member': 'target-member' });
    });

    it('reset-before-create mode deletes eligible current roles and recreates same-name requested roles', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'target-guild',
                guildName: 'Target Guild',
                roles: [
                    {
                        id: 'target-guild',
                        name: '@everyone',
                        position: 0,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                    {
                        id: 'target-member',
                        name: 'Member',
                        position: 1,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                ],
                categories: [],
                channels: [],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const requested = {
            ...current,
            guildId: 'source-guild',
            roles: [
                {
                    id: 'source-guild',
                    name: '@everyone',
                    position: 0,
                    color: 0,
                    permissions: '8',
                    hoist: false,
                    mentionable: false,
                },
                {
                    id: 'source-member',
                    name: 'Member',
                    position: 5,
                    color: 255,
                    permissions: '8',
                    hoist: true,
                    mentionable: true,
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested, {
            policy: 'rebuild',
        });

        expect(plan.summary).toStrictEqual({
            creates: 1,
            updates: 1,
            deletes: 1,
            roles: 3,
            categories: 0,
            channels: 0,
        });
        expect(plan.actions.map((action) => [action.actionType, action.targetType, action.targetId])).toStrictEqual([
            ['delete', 'role', 'target-member'],
            ['create', 'role', 'source-member'],
            ['update', 'role-order', 'role-order'],
        ]);
        expect(plan.roleProjection.roles.find((role) => role.sourceId === 'source-member')).toMatchObject({
            logicalId: 'source-member',
            disposition: 'create',
        });
        expect(plan.roleProjection.roles.find((role) => role.sourceId === 'source-member')).not.toHaveProperty(
            'targetId'
        );
        expect(plan.roleProjection.roles.some((role) => role.logicalId === 'target-member')).toBe(false);
    });

    it('uses a unique exact same-name role match when duplicate roles already exist', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'target-guild',
                guildName: 'Target Guild',
                roles: [
                    {
                        id: 'target-member-duplicate',
                        name: 'Member',
                        position: 2,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                    {
                        id: 'target-member-kept',
                        name: 'Member',
                        position: 5,
                        color: 255,
                        permissions: '8',
                        hoist: true,
                        mentionable: true,
                    },
                ],
                categories: [],
                channels: [],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const requested = {
            ...current,
            guildId: 'source-guild',
            roles: [
                {
                    id: 'source-member',
                    name: 'Member',
                    position: 5,
                    color: 255,
                    permissions: '8',
                    hoist: true,
                    mentionable: true,
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested, { policy: 'synchronize' });

        expect(plan.summary).toStrictEqual({
            creates: 0,
            updates: 1,
            deletes: 1,
            roles: 2,
            categories: 0,
            channels: 0,
        });
        expect(plan.actions).toStrictEqual([
            {
                actionType: 'delete',
                targetType: 'role',
                targetId: 'target-member-duplicate',
                label: 'Member',
                details: {
                    label: 'Member',
                    before: {
                        id: 'target-member-duplicate',
                        name: 'Member',
                        position: 2,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                },
            },
            expect.objectContaining({ actionType: 'update', targetId: 'role-order', targetType: 'role-order' }),
        ]);
        expect(plan.sourceTargetMap).toStrictEqual({ 'source-member': 'target-member-kept' });
    });

    it('matches shifted duplicate-name roles by projected shape and hierarchy', () => {
        const role = (
            id: string,
            name: string,
            position: number,
            hierarchyRank: number,
            color: number,
            protectedRole = false
        ) => ({
            id,
            name,
            position,
            hierarchyRank,
            color,
            permissions: '0',
            hoist: false,
            mentionable: false,
            ...(protectedRole ? { protected: true as const, protectionReason: 'bot' as const } : {}),
        });
        const current = toFluxerGuildStructureSnapshot({
            guildId: 'target-guild',
            guildName: 'Target',
            roles: [
                role('target-bot', 'Target Bot', 4, 0, 0, true),
                role('target-neon-top', 'NeonConductor', 3, 1, 10),
                role('target-member', 'Member', 2, 2, 20),
                role('target-neon-low', 'NeonConductor', 1, 3, 30),
                role('target-guild', '@everyone', 0, 4, 0),
            ],
            categories: [],
            channels: [],
        });
        const requested = toFluxerGuildStructureSnapshot({
            guildId: 'source-guild',
            guildName: 'Source',
            roles: [
                role('source-bot-one', 'Source Bot One', 5, 0, 0, true),
                role('source-bot-two', 'Source Bot Two', 4, 1, 0, true),
                role('source-neon-top', 'NeonConductor', 3, 2, 10),
                role('source-member', 'Member', 2, 3, 20),
                role('source-neon-low', 'NeonConductor', 1, 4, 30),
                role('source-guild', '@everyone', 0, 5, 0),
            ],
            categories: [],
            channels: [],
        });

        const plan = diffFluxerGuildStructureSnapshot(current, requested, { policy: 'synchronize' });

        expect(plan.actions).toStrictEqual([]);
        expect(plan.sourceTargetMap).toStrictEqual({
            'source-neon-top': 'target-neon-top',
            'source-member': 'target-member',
            'source-neon-low': 'target-neon-low',
        });
        expect(
            plan.roleProjection.roles
                .filter((entry) => entry.sourceId?.startsWith('source-neon'))
                .map((entry) => [entry.sourceId, entry.targetId, entry.position])
        ).toStrictEqual([
            ['source-neon-top', 'target-neon-top', 3],
            ['source-neon-low', 'target-neon-low', 1],
        ]);
    });

    it('accepts an explicit role mapping to resolve an equal optimum', () => {
        const member = (id: string, position: number) => ({
            id,
            name: 'Member',
            position,
            color: 0,
            permissions: '0',
            hoist: false,
            mentionable: false,
        });
        const current = toFluxerGuildStructureSnapshot({
            guildId: 'target-guild',
            guildName: 'Target',
            roles: [member('target-top', 3), { ...member('anchor', 2), name: 'Anchor' }, member('target-low', 1)],
            categories: [],
            channels: [],
        });
        const requested = toFluxerGuildStructureSnapshot({
            guildId: 'source-guild',
            guildName: 'Source',
            roles: [
                { ...member('source-top', 3), name: 'Top' },
                member('source-member', 2),
                { ...member('source-low', 1), name: 'Low' },
            ],
            categories: [],
            channels: [],
        });

        const plan = diffFluxerGuildStructureSnapshot(current, requested, {
            policy: 'synchronize',
            roleMappings: { 'source-member': 'target-low' },
        });

        expect(plan.sourceTargetMap).toMatchObject({ 'source-member': 'target-low' });
        expect(plan.roleProjection.roles.find((entry) => entry.sourceId === 'source-member')).toMatchObject({
            targetId: 'target-low',
            disposition: 'matched',
        });
        expect(() =>
            diffFluxerGuildStructureSnapshot(current, requested, {
                policy: 'synchronize',
                roleMappings: { missing: 'target-low' },
            })
        ).toThrow(FluxerGuildStructureInvalidIdentityMappingError);
    });

    it('can omit deletes for merge-mode import previews', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'guild-1',
                guildName: 'Guild 1',
                roles: [
                    {
                        id: 'role-extra',
                        name: 'Extra',
                        position: 1,
                        color: 0,
                        permissions: '0',
                        hoist: false,
                        mentionable: false,
                    },
                ],
                categories: [],
                channels: [],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const requested = { ...current, roles: [] };

        const deletingPlan = diffFluxerGuildStructureSnapshot(current, requested, { policy: 'synchronize' });
        const retainingPlan = diffFluxerGuildStructureSnapshot(current, requested, { policy: 'merge' });

        expect(deletingPlan.summary.deletes).toBe(1);
        expect(deletingPlan.roleProjection.roles).toStrictEqual([]);
        expect(retainingPlan.actions).toStrictEqual([]);
        expect(retainingPlan.roleProjection.roles).toEqual([
            expect.objectContaining({ logicalId: 'role-extra', disposition: 'retained' }),
        ]);
    });

    it('compares permission overwrites after mapping source role ids to target role ids', () => {
        const role = (id: string) => ({
            id,
            name: 'Member',
            position: 1,
            color: 0,
            permissions: '0',
            hoist: false,
            mentionable: false,
        });
        const channel = (overwriteId: string, allow = '1') => ({
            id: 'channel-1',
            name: 'general',
            type: 0,
            parentId: null,
            position: 1,
            permissionOverwrites: [{ id: overwriteId, type: 0, allow, deny: '0' }],
        });
        const current = toFluxerGuildStructureSnapshot({
            guildId: 'target-guild',
            guildName: 'Target',
            roles: [role('target-member')],
            categories: [],
            channels: [channel('target-member')],
        });
        const requested = toFluxerGuildStructureSnapshot({
            guildId: 'source-guild',
            guildName: 'Source',
            roles: [role('source-member')],
            categories: [],
            channels: [channel('source-member')],
        });

        expect(diffFluxerGuildStructureSnapshot(current, requested, { policy: 'synchronize' }).actions).toStrictEqual(
            []
        );

        const changed = {
            ...requested,
            channels: [channel('source-member', '2')],
        };
        const changedPlan = diffFluxerGuildStructureSnapshot(current, changed, { policy: 'synchronize' });
        expect(changedPlan.actions).toHaveLength(1);
        expect(changedPlan.actions[0]).toMatchObject({
            actionType: 'update',
            targetType: 'channel',
            targetId: 'channel-1',
            details: {
                changes: [
                    {
                        field: 'permissionOverwrites',
                        before: [{ id: 'target-member', type: 0, allow: '1', deny: '0' }],
                        after: [{ id: 'target-member', type: 0, allow: '2', deny: '0' }],
                    },
                ],
            },
        });
    });

    it('represents position-only sibling drift with one channel-order action', () => {
        const createChannel = (id: string, position: number) => ({
            id,
            name: id,
            type: 0,
            parentId: null,
            position,
            permissionOverwrites: [],
        });
        const current = toFluxerGuildStructureSnapshot({
            guildId: 'guild-1',
            guildName: 'Guild',
            roles: [],
            categories: [],
            channels: [createChannel('alpha', 1), createChannel('beta', 2)],
        });
        const requested = {
            ...current,
            channels: [createChannel('alpha', 2), createChannel('beta', 1)],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested, { policy: 'synchronize' });

        expect(plan.actions).toHaveLength(1);
        expect(plan.actions[0]).toMatchObject({
            actionType: 'update',
            targetType: 'channel-order',
            targetId: 'channel-order',
        });
        expect(plan.actions[0]?.details.changes).toStrictEqual([
            {
                field: 'channelOrder',
                before: [
                    { sourceId: 'alpha', parentSourceId: null, position: 0 },
                    { sourceId: 'beta', parentSourceId: null, position: 1 },
                ],
                after: [
                    { sourceId: 'beta', parentSourceId: null, position: 0 },
                    { sourceId: 'alpha', parentSourceId: null, position: 1 },
                ],
            },
        ]);
    });

    it('keeps unmatched merge siblings in the normalized future channel order', () => {
        const createChannel = (id: string, name: string, position: number) => ({
            id,
            name,
            type: 0,
            parentId: null,
            position,
            permissionOverwrites: [],
        });
        const current = toFluxerGuildStructureSnapshot({
            guildId: 'target-guild',
            guildName: 'Target',
            roles: [],
            categories: [],
            channels: [createChannel('target-alpha', 'alpha', 1), createChannel('retained', 'retained', 2)],
        });
        const requested = toFluxerGuildStructureSnapshot({
            guildId: 'source-guild',
            guildName: 'Source',
            roles: [],
            categories: [],
            channels: [createChannel('source-new', 'new', 1), createChannel('source-alpha', 'alpha', 2)],
        });

        const plan = diffFluxerGuildStructureSnapshot(current, requested, { policy: 'merge' });
        const orderAction = plan.actions.find((action) => action.targetType === 'channel-order');

        expect(orderAction?.details.before).toStrictEqual([
            { sourceId: 'target-alpha', parentSourceId: null, position: 0 },
            { sourceId: 'retained', parentSourceId: null, position: 1 },
        ]);
        expect(orderAction?.details.after).toStrictEqual([
            { sourceId: 'source-new', parentSourceId: null, position: 0 },
            { sourceId: 'retained', parentSourceId: null, position: 1 },
            { sourceId: 'source-alpha', parentSourceId: null, position: 2 },
        ]);
    });

    it('makes retained merge category and channel order references explicit destination identities', () => {
        const category = (id: string, name: string, position: number) => ({
            id,
            name,
            type: 4,
            parentId: null,
            position,
            permissionOverwrites: [],
        });
        const channel = (id: string, name: string, parentId: string, position: number) => ({
            id,
            name,
            type: 0,
            parentId,
            position,
            permissionOverwrites: [],
        });
        const current = toFluxerGuildStructureSnapshot({
            guildId: 'target-guild',
            guildName: 'Target',
            roles: [],
            categories: [category('retained-category', 'Retained', 0), category('target-category', 'Imported', 1)],
            channels: [
                channel('retained-channel', 'retained', 'retained-category', 0),
                channel('target-channel', 'imported', 'target-category', 0),
            ],
        });
        const requested = toFluxerGuildStructureSnapshot({
            guildId: 'source-guild',
            guildName: 'Source',
            roles: [],
            categories: [category('source-category', 'Imported', 0)],
            channels: [channel('source-channel', 'imported', 'source-category', 0)],
        });

        const plan = diffFluxerGuildStructureSnapshot(current, requested, { policy: 'merge' });
        const orderAction = plan.actions.find((action) => action.targetType === 'channel-order');

        expect(plan.sourceTargetMap).toStrictEqual({
            'source-category': 'target-category',
            'source-channel': 'target-channel',
        });
        expect(plan.knownTargetKinds).toStrictEqual({
            'retained-category': 'category',
            'retained-channel': 'channel',
            'target-category': 'category',
            'target-channel': 'channel',
            'target-guild': 'role',
        });
        expect(orderAction?.details.after).toEqual(
            expect.arrayContaining([
                { sourceId: 'retained-category', parentSourceId: null, position: 1 },
                {
                    sourceId: 'retained-channel',
                    parentSourceId: 'retained-category',
                    position: 0,
                },
            ])
        );
    });

    it('preserves target protected-role overwrites while diffing addressable overwrites', () => {
        const role = (id: string, name: string, protectedRole = false) => ({
            id,
            name,
            position: protectedRole ? 2 : 1,
            color: 0,
            permissions: '0',
            hoist: false,
            mentionable: false,
            ...(protectedRole ? { protected: true as const, protectionReason: 'bot' as const } : {}),
        });
        const channel = (memberId: string, memberAllow: string, botId: string) => ({
            id: 'channel-1',
            name: 'general',
            type: 0,
            parentId: null,
            position: 1,
            permissionOverwrites: [
                { id: botId, type: 0, allow: '8', deny: '0' },
                { id: memberId, type: 0, allow: memberAllow, deny: '0' },
            ],
        });
        const current = toFluxerGuildStructureSnapshot({
            guildId: 'target-guild',
            guildName: 'Target',
            roles: [role('target-bot', 'Target Bot', true), role('target-member', 'Member')],
            categories: [],
            channels: [channel('target-member', '1', 'target-bot')],
        });
        const requested = toFluxerGuildStructureSnapshot({
            guildId: 'source-guild',
            guildName: 'Source',
            roles: [role('source-bot', 'Source Bot', true), role('source-member', 'Member')],
            categories: [],
            channels: [channel('source-member', '1', 'source-bot')],
        });

        expect(diffFluxerGuildStructureSnapshot(current, requested, { policy: 'synchronize' }).actions).toStrictEqual(
            []
        );

        const changedPlan = diffFluxerGuildStructureSnapshot(
            current,
            {
                ...requested,
                channels: [channel('source-member', '2', 'source-bot')],
            },
            { policy: 'synchronize' }
        );
        expect(changedPlan.actions).toHaveLength(1);
        expect(changedPlan.actions[0]?.details.changes).toStrictEqual([
            {
                field: 'permissionOverwrites',
                before: [
                    { id: 'target-bot', type: 0, allow: '8', deny: '0' },
                    { id: 'target-member', type: 0, allow: '1', deny: '0' },
                ],
                after: [
                    { id: 'target-member', type: 0, allow: '2', deny: '0' },
                    { id: 'target-bot', type: 0, allow: '8', deny: '0' },
                ],
            },
        ]);
    });

    it('matches same-name same-type channels through matched category names without planning create and delete', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'guild-1',
                guildName: 'Guild 1',
                roles: [],
                categories: [
                    {
                        id: 'current-category',
                        name: 'Links',
                        type: 4,
                        parentId: null,
                        position: 1,
                        permissionOverwrites: [],
                    },
                ],
                channels: [
                    {
                        id: 'current-link',
                        name: 'docs',
                        type: 998,
                        url: 'https://github.com/example/current',
                        parentId: 'current-category',
                        position: 1,
                        permissionOverwrites: [],
                    },
                ],
            },
            '2026-06-26T10:00:00.000Z'
        );
        const requested = {
            ...current,
            categories: [
                {
                    id: 'requested-category',
                    name: 'Links',
                    type: 4,
                    parentId: null,
                    position: 1,
                    permissionOverwrites: [],
                },
            ],
            channels: [
                {
                    id: 'requested-link',
                    name: 'docs',
                    type: 998,
                    url: 'https://github.com/example/requested',
                    parentId: 'requested-category',
                    position: 2,
                    permissionOverwrites: [],
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested, { policy: 'synchronize' });

        expect(plan.summary).toStrictEqual({
            creates: 0,
            updates: 0,
            deletes: 0,
            roles: 0,
            categories: 0,
            channels: 0,
        });
        expect(plan.actions).toStrictEqual([]);
        expect(plan.sourceTargetMap).toStrictEqual({
            'requested-category': 'current-category',
            'requested-link': 'current-link',
        });
    });

    it('does not match same-name channels with different types as an update', () => {
        const current = toFluxerGuildStructureSnapshot(
            {
                guildId: 'guild-1',
                guildName: 'Guild 1',
                roles: [],
                categories: [],
                channels: [
                    {
                        id: 'current-text',
                        name: 'docs',
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
            channels: [
                {
                    id: 'requested-link',
                    name: 'docs',
                    type: 5,
                    parentId: null,
                    position: 1,
                    permissionOverwrites: [],
                },
            ],
        };

        const plan = diffFluxerGuildStructureSnapshot(current, requested, { policy: 'synchronize' });

        expect(plan.actions.map((action) => [action.actionType, action.targetType, action.targetId])).toStrictEqual([
            ['create', 'channel', 'requested-link'],
            ['delete', 'channel', 'current-text'],
            ['update', 'channel-order', 'channel-order'],
        ]);
    });
});
