import { describe, expect, it } from 'vitest';

import type { BlueprintSnapshot } from './snapshot.js';
import {
    BLUEPRINT_MUTATION_FENCE_DIAGNOSTIC_ID_LIMIT,
    compareBlueprintMutationFenceManifests,
    createBlueprintMutationFenceManifest,
    parseBlueprintMutationFenceManifest,
} from './mutation-fence.js';

const snapshot: BlueprintSnapshot = {
    version: 1,
    guildId: 'guild-1',
    guildName: 'Display name',
    exportedAt: '2026-07-15T00:00:00.000Z',
    botHighestRolePosition: 5,
    botHighestRoleHierarchyRank: 1,
    roles: [
        {
            id: 'role-b',
            name: 'B',
            position: 2,
            hierarchyRank: 99,
            color: 0,
            permissions: '0002',
            hoist: false,
            mentionable: false,
            protected: true,
            protectionReason: 'bot',
        },
        {
            id: 'role-a',
            name: 'A',
            position: 1,
            color: 1,
            permissions: '1',
            hoist: true,
            mentionable: true,
        },
    ],
    categories: [
        {
            id: 'category-a',
            name: 'Category',
            type: 4,
            parentId: null,
            position: 0,
            permissionOverwrites: [
                { id: 'role-b', type: 0, allow: '2', deny: '0' },
                { id: 'role-a', type: 0, allow: '0', deny: '1' },
            ],
        },
    ],
    channels: [
        {
            id: 'channel-a',
            name: 'Channel',
            type: 0,
            url: 'https://display.invalid',
            parentId: 'category-a',
            position: 0,
            permissionOverwrites: [],
        },
    ],
};

describe('Blueprint mutation fence V2', () => {
    it('ignores collection order, presentation fields, exported time, hierarchy rank, and bitfield formatting', async () => {
        const expected = await createBlueprintMutationFenceManifest(snapshot);
        const actual = await createBlueprintMutationFenceManifest({
            ...snapshot,
            guildName: 'Another display name',
            exportedAt: '2027-01-01T00:00:00.000Z',
            botHighestRoleHierarchyRank: 500,
            roles: [...snapshot.roles]
                .reverse()
                .map((role) => ({ ...role, hierarchyRank: (role.hierarchyRank ?? 0) + 10 })),
            categories: snapshot.categories.map((category) => ({
                ...category,
                permissionOverwrites: [...category.permissionOverwrites].reverse().map((overwrite) => ({
                    ...overwrite,
                    allow: BigInt(overwrite.allow).toString().padStart(4, '0'),
                })),
            })),
            channels: snapshot.channels.map((channel) => ({ ...channel, url: null })),
        });

        expect(actual.structureDigest).toBe(expected.structureDigest);
        expect(actual.capabilityDigest).toBe(expected.capabilityDigest);
        expect(compareBlueprintMutationFenceManifests(expected, actual).equal).toBe(true);
    });

    it('separates structural and capability changes and reports changed fields', async () => {
        const expected = await createBlueprintMutationFenceManifest(snapshot);
        const structural = await createBlueprintMutationFenceManifest({
            ...snapshot,
            roles: snapshot.roles.map((role) => (role.id === 'role-a' ? { ...role, permissions: '8' } : role)),
        });
        const capability = await createBlueprintMutationFenceManifest({
            ...snapshot,
            botHighestRolePosition: 4,
        });

        expect(compareBlueprintMutationFenceManifests(expected, structural)).toMatchObject({
            structureChanged: true,
            capabilityChanged: false,
            roles: { changed: [{ id: 'role-a', fields: ['permissions'] }] },
        });
        expect(compareBlueprintMutationFenceManifests(expected, capability)).toMatchObject({
            structureChanged: false,
            capabilityChanged: true,
            capabilityFields: ['botHighestRolePosition'],
        });
    });

    it('round-trips through the strict parser', async () => {
        const manifest = await createBlueprintMutationFenceManifest(snapshot);
        expect(parseBlueprintMutationFenceManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
    });

    it('is deterministic across one hundred independent collection permutations without mutating inputs', async () => {
        const category = snapshot.categories[0];
        const channel = snapshot.channels[0];
        if (!category || !channel) throw new Error('mutation-fence-test-channel-required');
        const permutationSnapshot: BlueprintSnapshot = {
            ...snapshot,
            categories: [category, { ...category, id: 'category-b', name: 'Category B' }],
            channels: [channel, { ...channel, id: 'channel-b', name: 'Channel B' }],
        };
        const baselineJson = JSON.stringify(permutationSnapshot);
        const expected = await createBlueprintMutationFenceManifest(permutationSnapshot);
        for (let seed = 1; seed <= 100; seed += 1) {
            const actual = await createBlueprintMutationFenceManifest({
                ...permutationSnapshot,
                roles: permute(permutationSnapshot.roles, seed),
                categories: permute(permutationSnapshot.categories, seed + 100).map((category) => ({
                    ...category,
                    permissionOverwrites: permute(category.permissionOverwrites, seed + 200),
                })),
                channels: permute(permutationSnapshot.channels, seed + 300),
            });
            expect(actual.structureDigest).toBe(expected.structureDigest);
            expect(actual.capabilityDigest).toBe(expected.capabilityDigest);
        }
        expect(JSON.stringify(permutationSnapshot)).toBe(baselineJson);
    });

    it('keeps guild identity authoritative while excluding presentation and volatile fields', async () => {
        const expected = await createBlueprintMutationFenceManifest(snapshot);
        const presentationOnly = await createBlueprintMutationFenceManifest({
            ...snapshot,
            guildName: 'Renamed for display',
            exportedAt: '2099-01-01T00:00:00.000Z',
            channels: snapshot.channels.map((channel) => ({ ...channel, url: 'https://changed.invalid' })),
        });
        expect(presentationOnly.structureDigest).toBe(expected.structureDigest);
        await expect(createBlueprintMutationFenceManifest({ ...snapshot, guildId: '' })).rejects.toThrow(
            'blueprint-mutation-fence-guild-id-required'
        );
        const anotherGuild = await createBlueprintMutationFenceManifest({ ...snapshot, guildId: 'guild-2' });
        expect(anotherGuild.structureDigest).not.toBe(expected.structureDigest);
    });

    it('bounds mismatch samples while retaining complete counts', async () => {
        const roleTemplate = snapshot.roles[1];
        if (!roleTemplate) throw new Error('mutation-fence-test-role-required');
        const roles = Array.from({ length: BLUEPRINT_MUTATION_FENCE_DIAGNOSTIC_ID_LIMIT + 10 }, (_, index) => ({
            ...roleTemplate,
            id: `extra-${String(index).padStart(3, '0')}`,
        }));
        const expected = await createBlueprintMutationFenceManifest({ ...snapshot, roles: [] });
        const actual = await createBlueprintMutationFenceManifest({ ...snapshot, roles });
        const comparison = compareBlueprintMutationFenceManifests(expected, actual);
        expect(comparison.roles.addedCount).toBe(60);
        expect(comparison.roles.added).toHaveLength(BLUEPRINT_MUTATION_FENCE_DIAGNOSTIC_ID_LIMIT);
        expect(comparison.truncated).toBe(true);
    });

    it('rejects manifests above the bounded persistence size', async () => {
        const manifest = await createBlueprintMutationFenceManifest(snapshot);
        const oversized = {
            ...manifest,
            roles: Array.from({ length: 4_000 }, (_, index) => ({
                id: `role-${String(index).padStart(5, '0')}`,
                digest: 'a'.repeat(32),
                fieldDigests: Array.from({ length: 6 }, () => 'b'.repeat(32)),
            })),
        };
        expect(() => parseBlueprintMutationFenceManifest(oversized)).toThrow(
            'blueprint-mutation-fence-manifest-too-large'
        );
    });
});

function permute<T>(values: readonly T[], seed: number): T[] {
    const result = [...values];
    let state = seed >>> 0;
    for (let index = result.length - 1; index > 0; index -= 1) {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0;
        const target = state % (index + 1);
        [result[index], result[target]] = [result[target] as T, result[index] as T];
    }
    return result;
}
