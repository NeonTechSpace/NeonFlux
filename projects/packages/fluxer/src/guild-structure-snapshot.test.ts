import { describe, expect, it } from 'vitest';

import {
    createFluxerGuildStructureSnapshotFingerprintInput,
    FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS,
    isFluxerGuildStructureSnapshotJsonWithinByteLimit,
    normalizeFluxerGuildStructureSnapshot,
    toFluxerGuildStructureExportSnapshot,
    type FluxerGuildStructureSnapshot,
} from './guild-structure-snapshot.js';
import type { FluxerGuildStructure } from './guild-structure.js';

const validRole = {
    id: 'role-1',
    name: 'Member',
    position: 1,
    color: 0,
    permissions: '0',
    hoist: false,
    mentionable: false,
};

const validChannel = {
    id: 'channel-1',
    name: 'general',
    type: 0,
    parentId: null,
    position: 1,
    permissionOverwrites: [],
};

describe('guild structure export snapshots', () => {
    it('omits bot roles and their role overwrites while preserving portable structure', () => {
        const structure: FluxerGuildStructure = {
            guildId: 'guild-1',
            guildName: 'Guild 1',
            roles: [
                { ...validRole, id: 'guild-1', name: '@everyone', position: 0 },
                validRole,
                {
                    ...validRole,
                    id: 'bot-role',
                    name: 'Blueprint Bot',
                    protected: true,
                    protectionReason: 'bot',
                },
                {
                    ...validRole,
                    id: 'managed-role',
                    name: 'Managed',
                    protected: true,
                    protectionReason: 'managed',
                },
            ],
            categories: [
                {
                    ...validChannel,
                    id: 'category-1',
                    name: 'Team',
                    type: 4,
                    permissionOverwrites: [
                        { id: 'bot-role', type: 0, allow: '8', deny: '0' },
                        { id: 'managed-role', type: 0, allow: '0', deny: '8' },
                    ],
                },
            ],
            channels: [
                {
                    ...validChannel,
                    parentId: 'category-1',
                    permissionOverwrites: [
                        { id: 'bot-role', type: 0, allow: '8', deny: '0' },
                        { id: 'bot-role', type: 1, allow: '4', deny: '0' },
                        { id: 'role-1', type: 0, allow: '0', deny: '8' },
                    ],
                },
            ],
        };

        const snapshot = toFluxerGuildStructureExportSnapshot(structure, '2026-07-14T10:00:00.000Z');

        expect(snapshot.roles.map((role) => role.id)).toStrictEqual(['guild-1', 'role-1', 'managed-role']);
        expect(snapshot.categories[0]?.permissionOverwrites).toStrictEqual([
            { id: 'managed-role', type: 0, allow: '0', deny: '8' },
        ]);
        expect(snapshot.channels[0]?.permissionOverwrites).toStrictEqual([
            { id: 'bot-role', type: 1, allow: '4', deny: '0' },
            { id: 'role-1', type: 0, allow: '0', deny: '8' },
        ]);
        expect(normalizeFluxerGuildStructureSnapshot(snapshot)).toStrictEqual({ type: 'valid', snapshot });
    });
});

describe('guild structure snapshot input bounds', () => {
    it('measures the JSON limit in UTF-8 bytes', () => {
        const exactMultibyteLimit = 'é'.repeat(FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxJsonBytes / 2);
        const exactAstralLimit = '😀'.repeat(FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxJsonBytes / 4);

        expect(isFluxerGuildStructureSnapshotJsonWithinByteLimit(exactMultibyteLimit)).toBe(true);
        expect(isFluxerGuildStructureSnapshotJsonWithinByteLimit(`${exactMultibyteLimit}é`)).toBe(false);
        expect(isFluxerGuildStructureSnapshotJsonWithinByteLimit(exactAstralLimit)).toBe(true);
        expect(isFluxerGuildStructureSnapshotJsonWithinByteLimit(`${exactAstralLimit}😀`)).toBe(false);
    });

    it.each([
        ['roles', FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxRoles + 1, validRole, '250 roles'],
        ['categories', FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxCategories + 1, validChannel, '500 categories'],
        ['channels', FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxChannels + 1, validChannel, '500 channels'],
    ] as const)('rejects excessive %s', (field, count, item, expectedMessage) => {
        const items = Array.from({ length: count }, () => item);
        const result = normalizeFluxerGuildStructureSnapshot({
            roles: field === 'roles' ? items : [],
            categories: field === 'categories' ? items : [],
            channels: field === 'channels' ? items : [],
        });

        expect(result.type).toBe('invalid');
        if (result.type !== 'invalid') throw new Error('Expected the oversized collection to be rejected.');
        expect(result.message).toContain(expectedMessage);
    });

    it('caps combined categories and channels at the platform guild-channel limit', () => {
        const result = normalizeFluxerGuildStructureSnapshot({
            roles: [],
            categories: [validChannel],
            channels: Array(FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxTotalChannels).fill(validChannel),
        });

        expect(result).toStrictEqual({
            type: 'invalid',
            message: 'Server blueprint JSON cannot contain more than 500 total categories and channels.',
        });
    });

    it('rejects excessive permission overwrites before relationship processing', () => {
        const result = normalizeFluxerGuildStructureSnapshot({
            roles: [],
            categories: [],
            channels: [
                {
                    ...validChannel,
                    permissionOverwrites: Array(
                        FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxPermissionOverwritesPerChannel + 1
                    ).fill({ id: 'role-1', type: 0, allow: '0', deny: '0' }),
                },
            ],
        });

        expect(result).toStrictEqual({
            type: 'invalid',
            message: 'Channel 1 cannot contain more than 1000 permission overwrites.',
        });
    });

    it.each([
        [
            { guildName: 'g'.repeat(FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxGuildNameLength + 1) },
            'Server name cannot exceed 100 characters.',
        ],
        [
            {
                roles: [
                    {
                        ...validRole,
                        name: 'r'.repeat(FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxRoleNameLength + 1),
                    },
                ],
            },
            'Role 1 name cannot exceed 100 characters.',
        ],
        [
            {
                channels: [
                    {
                        ...validChannel,
                        url: 'u'.repeat(FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxChannelUrlLength + 1),
                    },
                ],
            },
            'Channel 1 URL cannot exceed 2048 characters.',
        ],
        [
            {
                roles: [
                    {
                        ...validRole,
                        permissions: '1'.repeat(FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxPermissionBitfieldLength + 1),
                    },
                ],
            },
            'Role 1 permissions cannot exceed 32 characters.',
        ],
    ])('rejects bounded text fields with a precise message', (partial, expectedMessage) => {
        const result = normalizeFluxerGuildStructureSnapshot({
            roles: [],
            categories: [],
            channels: [],
            ...partial,
        });

        expect(result).toStrictEqual({ type: 'invalid', message: expectedMessage });
    });
});

describe('guild structure snapshot fingerprint input', () => {
    it('excludes generated export time while retaining live structure and identity metadata', () => {
        const snapshot: FluxerGuildStructureSnapshot = {
            version: 1,
            guildId: 'guild-1',
            guildName: 'Guild 1',
            botHighestRolePosition: 7,
            botHighestRoleHierarchyRank: 2,
            exportedAt: '2026-07-13T10:00:00.000Z',
            roles: [validRole],
            categories: [],
            channels: [validChannel],
        };

        const first = createFluxerGuildStructureSnapshotFingerprintInput(snapshot);
        const second = createFluxerGuildStructureSnapshotFingerprintInput({
            ...snapshot,
            exportedAt: '2026-07-13T11:00:00.000Z',
        });

        expect(first).toStrictEqual(second);
        expect(first).toStrictEqual({
            version: 1,
            guildId: 'guild-1',
            guildName: 'Guild 1',
            botHighestRolePosition: 7,
            botHighestRoleHierarchyRank: 2,
            roles: [validRole],
            categories: [],
            channels: [validChannel],
        });
        expect(first).not.toHaveProperty('exportedAt');
    });
});
