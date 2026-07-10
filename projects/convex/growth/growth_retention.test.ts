import { describe, expect, it, vi } from 'vitest';

import {
    dailyGrowthRetentionDays,
    executeGrowthRetentionBatch,
    growthRetentionBatchSize,
    growthRetentionCutoff,
    nextGrowthRetentionKind,
    rawGrowthRetentionDays,
    type GrowthRetentionKind,
    type GrowthRetentionOperations,
} from './growth_retention.js';

describe('growth retention', () => {
    it('uses server-time cutoffs with separate raw and aggregate lifetimes', () => {
        const now = '2026-07-10T12:00:00.000Z';

        expect(rawGrowthRetentionDays).toBe(120);
        expect(dailyGrowthRetentionDays).toBe(400);
        expect(growthRetentionCutoff('member-events', now)).toBe('2026-03-12T12:00:00.000Z');
        expect(growthRetentionCutoff('message-days', now)).toBe('2026-03-12');
        expect(growthRetentionCutoff('daily-aggregates', now)).toBe('2025-06-05');
        expect(growthRetentionCutoff('inactive-invites', now)).toBe('');
    });

    it('deletes one bounded page and self-schedules the same kind while more rows remain', async () => {
        const operations = createOperations(growthRetentionBatchSize + 1);

        const result = await executeGrowthRetentionBatch(operations, {
            kind: 'member-events',
            now: '2026-07-10T12:00:00.000Z',
        });

        expect(operations.loadExpiredIds).toHaveBeenCalledWith(
            'member-events',
            '2026-03-12T12:00:00.000Z',
            growthRetentionBatchSize + 1
        );
        expect(operations.deleteIds).toHaveBeenCalledWith(
            'member-events',
            Array.from({ length: growthRetentionBatchSize }, (_, index) => `row-${String(index)}`)
        );
        expect(operations.schedule).toHaveBeenCalledWith('member-events');
        expect(result).toStrictEqual({
            deletedCount: growthRetentionBatchSize,
            hasMore: true,
            kind: 'member-events',
            scheduledKind: 'member-events',
        });
    });

    it('advances through every retention source and stops after inactive invites drain', async () => {
        expect(nextGrowthRetentionKind('member-events')).toBe('message-days');
        expect(nextGrowthRetentionKind('message-days')).toBe('daily-aggregates');
        expect(nextGrowthRetentionKind('daily-aggregates')).toBe('inactive-invites');
        expect(nextGrowthRetentionKind('inactive-invites')).toBeNull();

        const operations = createOperations(0);
        const result = await executeGrowthRetentionBatch(operations, {
            kind: 'inactive-invites',
            now: '2026-07-10T12:00:00.000Z',
        });

        expect(operations.schedule).not.toHaveBeenCalled();
        expect(result).toStrictEqual({
            deletedCount: 0,
            hasMore: false,
            kind: 'inactive-invites',
            scheduledKind: null,
        });
    });
});

function createOperations(rowCount: number): GrowthRetentionOperations & {
    deleteIds: ReturnType<typeof vi.fn>;
    loadExpiredIds: ReturnType<typeof vi.fn>;
    schedule: ReturnType<typeof vi.fn>;
} {
    const loadExpiredIds = vi.fn((_kind: GrowthRetentionKind, _cutoff: string, limit: number) =>
        Promise.resolve(Array.from({ length: Math.min(rowCount, limit) }, (_, index) => `row-${String(index)}`))
    );
    const deleteIds = vi.fn(() => Promise.resolve());
    const schedule = vi.fn(() => Promise.resolve());

    return { deleteIds, loadExpiredIds, schedule } as unknown as GrowthRetentionOperations & {
        deleteIds: ReturnType<typeof vi.fn>;
        loadExpiredIds: ReturnType<typeof vi.fn>;
        schedule: ReturnType<typeof vi.fn>;
    };
}
