import { describe, expect, it } from 'vitest';

import {
    buildDashboardStructureExplorerJsonDiff,
    formatDashboardStructureExplorerSnapshotJson,
} from './dashboard-structure-explorer-diff.js';
import type { DashboardStructureExplorerSnapshot } from './dashboard-structure-explorer-model.js';

describe('buildDashboardStructureExplorerJsonDiff', () => {
    it('builds a file diff for changed server blueprint JSON', () => {
        const before = formatDashboardStructureExplorerSnapshotJson(createSnapshot());
        const after = formatDashboardStructureExplorerSnapshotJson(
            createSnapshot({
                channels: [
                    {
                        ...createSnapshot().channels[0],
                        name: 'announcements',
                    },
                ],
            })
        );

        const result = buildDashboardStructureExplorerJsonDiff({
            after,
            afterLabel: 'Import JSON',
            before,
            beforeLabel: 'Live / source',
        });

        expect(result.type).toBe('diff');
        expect(result.beforeLabel).toBe('Live / source');
        expect(result.afterLabel).toBe('Import JSON');
        if (result.type !== 'diff') {
            throw new Error(`Expected diff result, got ${result.type}`);
        }
        expect(result.fileDiff.name).toBe('Import JSON.json');
        expect(result.fileDiff.prevName).toBe('Live source.json');
        expect(result.fileDiff.hunks.length).toBeGreaterThan(0);
    });

    it('returns a no-difference state when canonical JSON matches', () => {
        const before = formatDashboardStructureExplorerSnapshotJson(createSnapshot());

        expect(
            buildDashboardStructureExplorerJsonDiff({
                after: before,
                afterLabel: 'Import JSON',
                before,
                beforeLabel: 'Live server layout',
            })
        ).toMatchObject({
            afterLabel: 'Import JSON',
            beforeLabel: 'Live server layout',
            type: 'same',
        });
    });

    it('returns capped state before building large inline diffs', () => {
        const result = buildDashboardStructureExplorerJsonDiff({
            after: 'b'.repeat(8),
            afterLabel: 'Comparison',
            before: 'a'.repeat(8),
            beforeLabel: 'Source',
            limit: 10,
        });

        expect(result).toEqual({
            afterLabel: 'Comparison',
            afterLength: 8,
            beforeLabel: 'Source',
            beforeLength: 8,
            limit: 10,
            type: 'capped',
        });
    });
});

function createSnapshot(
    overrides: Partial<DashboardStructureExplorerSnapshot> = {}
): DashboardStructureExplorerSnapshot {
    return {
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
                id: 'channel-1',
                name: 'general',
                parentId: 'category-general',
                permissionOverwrites: [],
                position: 1,
                type: 0,
            },
        ],
        exportedAt: '2026-07-09T10:00:00.000Z',
        guildId: 'guild-1',
        guildName: 'NeonSpace',
        roles: [
            {
                color: 0,
                hoist: true,
                id: 'role-admin',
                mentionable: true,
                name: 'Admin',
                permissions: '8',
                position: 5,
            },
        ],
        version: 1,
        ...overrides,
    };
}
