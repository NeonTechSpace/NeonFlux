import { describe, expect, it, vi } from 'vitest';

import {
    executeGrowthRetentionBatch,
    growthRetentionBatchSize,
    growthRetentionCutoff,
    nextGrowthRetentionKind,
    type GrowthRetentionKind,
    type GrowthRetentionOperations,
} from './growth_retention.js';

describe('growth retention', () => {
    it('uses server-time cutoffs with separate raw and aggregate lifetimes', () => {
        const now = '2026-07-10T12:00:00.000Z';

        expect(growthRetentionCutoff('member-events', now, 90)).toBe('2026-04-11T12:00:00.000Z');
        expect(growthRetentionCutoff('message-receipts', now, 90)).toBe('2026-04-11T12:00:00.000Z');
        expect(growthRetentionCutoff('daily-aggregates', now, 90)).toBe('2026-04-11');
        expect(growthRetentionCutoff('inactive-invites', now, 90)).toBe('');
    });

    it('deletes one bounded page and self-schedules the same kind while more rows remain', async () => {
        const operations = createOperations(growthRetentionBatchSize + 1);

        const result = await executeGrowthRetentionBatch(operations, {
            kind: 'member-events',
            now: '2026-07-10T12:00:00.000Z',
            retentionDays: 90,
        });

        expect(operations.loadExpiredIds).toHaveBeenCalledWith(
            'member-events',
            '2026-04-11T12:00:00.000Z',
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
        expect(nextGrowthRetentionKind('member-events')).toBe('message-receipts');
        expect(nextGrowthRetentionKind('message-receipts')).toBe('daily-aggregates');
        expect(nextGrowthRetentionKind('daily-aggregates')).toBe('inactive-invites');
        expect(nextGrowthRetentionKind('inactive-invites')).toBeNull();

        const operations = createOperations(0);
        const result = await executeGrowthRetentionBatch(operations, {
            kind: 'inactive-invites',
            now: '2026-07-10T12:00:00.000Z',
            retentionDays: 90,
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
