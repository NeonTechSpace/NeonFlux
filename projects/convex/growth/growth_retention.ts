import { v, type GenericId } from 'convex/values';

import { internal } from '../_generated/api.js';
import { internalMutation, type MutationCtx } from '../_generated/server.js';
import { dataRetentionCutoff, readDataRetentionDays } from '../retention/retention_policy.js';

export const growthRetentionBatchSize = 200;

export type GrowthRetentionKind = 'member-events' | 'message-receipts' | 'daily-aggregates' | 'inactive-invites';

type GrowthRetentionId =
    | GenericId<'guildMemberFlowEvents'>
    | GenericId<'guildMessageActivityReceipts'>
    | GenericId<'guildGrowthDailyAggregates'>
    | GenericId<'guildInviteSnapshots'>;

export type GrowthRetentionOperations = {
    deleteIds: (kind: GrowthRetentionKind, ids: GrowthRetentionId[]) => Promise<void>;
    loadExpiredIds: (kind: GrowthRetentionKind, cutoff: string, limit: number) => Promise<GrowthRetentionId[]>;
    schedule: (kind: GrowthRetentionKind) => Promise<void>;
};

const growthRetentionKindValidator = v.union(
    v.literal('member-events'),
    v.literal('message-receipts'),
    v.literal('daily-aggregates'),
    v.literal('inactive-invites')
);

export const pruneGrowthRetentionBatch = internalMutation({
    args: { kind: growthRetentionKindValidator },
    returns: v.object({
        deletedCount: v.number(),
        hasMore: v.boolean(),
        kind: growthRetentionKindValidator,
        scheduledKind: v.union(growthRetentionKindValidator, v.null()),
    }),
    handler: async (ctx, args) => {
        return await executeGrowthRetentionBatch(createGrowthRetentionOperations(ctx), {
            kind: args.kind,
            now: new Date().toISOString(),
        });
    },
});

export async function executeGrowthRetentionBatch(
    operations: GrowthRetentionOperations,
    input: { kind: GrowthRetentionKind; limit?: number; now: string; retentionDays?: number }
): Promise<{
    deletedCount: number;
    hasMore: boolean;
    kind: GrowthRetentionKind;
    scheduledKind: GrowthRetentionKind | null;
}> {
    const limit = normalizeBatchLimit(input.limit);
    const cutoff = growthRetentionCutoff(input.kind, input.now, input.retentionDays ?? readDataRetentionDays());
    const ids = await operations.loadExpiredIds(input.kind, cutoff, limit + 1);
    const hasMore = ids.length > limit;
    const idsToDelete = ids.slice(0, limit);
    await operations.deleteIds(input.kind, idsToDelete);

    const scheduledKind = hasMore ? input.kind : nextGrowthRetentionKind(input.kind);
    if (scheduledKind) await operations.schedule(scheduledKind);

    return {
        deletedCount: idsToDelete.length,
        hasMore,
        kind: input.kind,
        scheduledKind,
    };
}

export function growthRetentionCutoff(kind: GrowthRetentionKind, now: string, retentionDays: number): string {
    if (kind === 'inactive-invites') return '';

    const cutoff = dataRetentionCutoff(now, retentionDays);
    return kind === 'daily-aggregates' ? cutoff.slice(0, 10) : cutoff;
}

export function nextGrowthRetentionKind(kind: GrowthRetentionKind): GrowthRetentionKind | null {
    switch (kind) {
        case 'member-events':
            return 'message-receipts';
        case 'message-receipts':
            return 'daily-aggregates';
        case 'daily-aggregates':
            return 'inactive-invites';
        case 'inactive-invites':
            return null;
    }
}

function createGrowthRetentionOperations(ctx: MutationCtx): GrowthRetentionOperations {
    return {
        deleteIds: async (kind, ids) => {
            for (const id of ids) {
                switch (kind) {
                    case 'member-events':
                        await ctx.db.delete('guildMemberFlowEvents', id as GenericId<'guildMemberFlowEvents'>);
                        break;
                    case 'message-receipts':
                        await ctx.db.delete(
                            'guildMessageActivityReceipts',
                            id as GenericId<'guildMessageActivityReceipts'>
                        );
                        break;
                    case 'daily-aggregates':
                        await ctx.db.delete(
                            'guildGrowthDailyAggregates',
                            id as GenericId<'guildGrowthDailyAggregates'>
                        );
                        break;
                    case 'inactive-invites':
                        await ctx.db.delete('guildInviteSnapshots', id as GenericId<'guildInviteSnapshots'>);
                        break;
                }
            }
        },
        loadExpiredIds: async (kind, cutoff, limit) => await loadExpiredGrowthIds(ctx, kind, cutoff, limit),
        schedule: async (kind) => {
            await ctx.scheduler.runAfter(0, internal.growth.growth_retention.pruneGrowthRetentionBatch, { kind });
        },
    };
}

async function loadExpiredGrowthIds(
    ctx: MutationCtx,
    kind: GrowthRetentionKind,
    cutoff: string,
    limit: number
): Promise<GrowthRetentionId[]> {
    switch (kind) {
        case 'member-events':
            return (
                await ctx.db
                    .query('guildMemberFlowEvents')
                    .withIndex('by_occurred', (index) => index.lt('occurredAt', cutoff))
                    .take(limit)
            ).map((row) => row._id);
        case 'message-receipts':
            return (
                await ctx.db
                    .query('guildMessageActivityReceipts')
                    .withIndex('by_occurred', (index) => index.lt('occurredAt', cutoff))
                    .take(limit)
            ).map((row) => row._id);
        case 'daily-aggregates':
            return (
                await ctx.db
                    .query('guildGrowthDailyAggregates')
                    .withIndex('by_date', (index) => index.lt('activityDate', cutoff))
                    .take(limit)
            ).map((row) => row._id);
        case 'inactive-invites':
            return (
                await ctx.db
                    .query('guildInviteSnapshots')
                    .withIndex('by_active', (index) => index.eq('active', false))
                    .take(limit)
            ).map((row) => row._id);
    }
}

function normalizeBatchLimit(limit: number | undefined): number {
    if (limit === undefined) return growthRetentionBatchSize;
    return Number.isInteger(limit) && limit > 0 ? Math.min(limit, growthRetentionBatchSize) : growthRetentionBatchSize;
}
