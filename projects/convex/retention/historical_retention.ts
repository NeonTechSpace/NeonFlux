import { v, type GenericId } from 'convex/values';

import { internal } from '../_generated/api.js';
import { internalMutation, type MutationCtx } from '../_generated/server.js';
import { dataRetentionCutoff, readDataRetentionDays } from './retention_policy.js';

export const historicalRetentionBatchSize = 100;

export const protectedStructureExecutionStatuses = [
    'queued',
    'running',
    'waiting_rate_limit',
    'pause_requested',
    'paused',
    'verifying',
    'needs_reconciliation',
    'outcome_unknown',
] as const;

export const deletableStructureExecutionStatuses = [
    'succeeded',
    'partially_applied',
    'failed_before_mutation',
    'cancelled',
] as const;

export type HistoricalRetentionPhase =
    | 'audit-events'
    | 'blueprint-select'
    | 'blueprint-executions'
    | 'blueprint-actions'
    | 'blueprint-decisions'
    | 'blueprint-approvals'
    | 'blueprint-preflights'
    | 'blueprint-run';

type BlueprintChildPhase = Exclude<
    HistoricalRetentionPhase,
    'audit-events' | 'blueprint-select' | 'blueprint-executions' | 'blueprint-run'
>;
type BlueprintRemainingPhase = Exclude<HistoricalRetentionPhase, 'audit-events' | 'blueprint-select' | 'blueprint-run'>;

export type HistoricalRetentionContinuation = {
    cutoff: string;
    phase: HistoricalRetentionPhase;
    runId?: string;
    scanCursor?: string;
};

export type HistoricalRetentionOperations = {
    claimExpiredRun: (runId: string, cutoff: string) => Promise<boolean>;
    deleteAuditEventIds: (ids: string[]) => Promise<void>;
    deleteBlueprintChildIds: (phase: BlueprintChildPhase | 'blueprint-attempts', ids: string[]) => Promise<void>;
    deleteExecution: (executionId: string) => Promise<void>;
    deleteRun: (runId: string) => Promise<void>;
    findRemainingRunPhase: (runId: string) => Promise<BlueprintRemainingPhase | null>;
    hasProtectedExecution: (runId: string) => Promise<boolean>;
    loadAttemptIds: (executionId: string, limit: number) => Promise<string[]>;
    loadBlueprintChildIds: (phase: BlueprintChildPhase, runId: string, limit: number) => Promise<string[]>;
    loadExpiredAuditEventIds: (cutoff: string, limit: number) => Promise<string[]>;
    loadFirstExecution: (runId: string) => Promise<{ id: string; status: string } | null>;
    loadNextExpiredRun: (
        cutoff: string,
        cursor: string | null
    ) => Promise<{ continueCursor: string; isDone: boolean; runId: string | null }>;
    loadRunState: (runId: string) => Promise<{ status: string; updatedAt: string } | null>;
    schedule: (continuation: HistoricalRetentionContinuation) => Promise<void>;
};

const historicalRetentionPhaseValidator = v.union(
    v.literal('audit-events'),
    v.literal('blueprint-select'),
    v.literal('blueprint-executions'),
    v.literal('blueprint-actions'),
    v.literal('blueprint-decisions'),
    v.literal('blueprint-approvals'),
    v.literal('blueprint-preflights'),
    v.literal('blueprint-run')
);

export const pruneHistoricalRetentionBatch = internalMutation({
    args: {
        cutoff: v.optional(v.string()),
        phase: v.optional(historicalRetentionPhaseValidator),
        runId: v.optional(v.string()),
        scanCursor: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await executeHistoricalRetentionBatch(createHistoricalRetentionOperations(ctx), {
            now: new Date().toISOString(),
            ...(args.cutoff ? { cutoff: args.cutoff } : {}),
            ...(args.phase ? { phase: args.phase } : {}),
            ...(args.runId ? { runId: args.runId } : {}),
            ...(args.scanCursor ? { scanCursor: args.scanCursor } : {}),
        });
        return null;
    },
});

export async function executeHistoricalRetentionBatch(
    operations: HistoricalRetentionOperations,
    input: {
        cutoff?: string;
        now: string;
        phase?: HistoricalRetentionPhase;
        retentionDays?: number;
        runId?: string;
        scanCursor?: string;
    }
): Promise<void> {
    const cutoff = input.cutoff ?? dataRetentionCutoff(input.now, input.retentionDays ?? readDataRetentionDays());
    const phase = input.phase ?? 'audit-events';

    if (phase === 'audit-events') {
        await pruneAuditEvents(operations, cutoff);
        return;
    }

    if (phase === 'blueprint-select') {
        await selectBlueprintRun(operations, cutoff, input.scanCursor);
        return;
    }

    const runId = input.runId;
    if (!runId) throw new Error('historical-retention-run-required');

    if (!(await runRemainsEligible(operations, runId, cutoff))) {
        await continueBlueprintScan(operations, cutoff, input.scanCursor);
        return;
    }

    if (phase === 'blueprint-executions') {
        await pruneBlueprintExecution(operations, {
            cutoff,
            runId,
            ...(input.scanCursor ? { scanCursor: input.scanCursor } : {}),
        });
        return;
    }

    if (phase === 'blueprint-run') {
        await pruneBlueprintRun(operations, {
            cutoff,
            runId,
            ...(input.scanCursor ? { scanCursor: input.scanCursor } : {}),
        });
        return;
    }

    await pruneBlueprintChildren(operations, {
        cutoff,
        phase,
        runId,
        ...(input.scanCursor ? { scanCursor: input.scanCursor } : {}),
    });
}

export function isProtectedStructureExecutionStatus(status: string): boolean {
    return protectedStructureExecutionStatuses.includes(status as never);
}

export function isDeletableStructureExecutionStatus(status: string): boolean {
    return deletableStructureExecutionStatuses.includes(status as never);
}

async function pruneAuditEvents(operations: HistoricalRetentionOperations, cutoff: string): Promise<void> {
    const ids = await operations.loadExpiredAuditEventIds(cutoff, historicalRetentionBatchSize + 1);
    const hasMore = ids.length > historicalRetentionBatchSize;
    await operations.deleteAuditEventIds(ids.slice(0, historicalRetentionBatchSize));
    await operations.schedule({ cutoff, phase: hasMore ? 'audit-events' : 'blueprint-select' });
}

async function selectBlueprintRun(
    operations: HistoricalRetentionOperations,
    cutoff: string,
    scanCursor: string | undefined
): Promise<void> {
    const candidate = await operations.loadNextExpiredRun(cutoff, scanCursor ?? null);
    if (!candidate.runId) return;

    if (!(await operations.claimExpiredRun(candidate.runId, cutoff))) {
        if (!candidate.isDone) {
            await operations.schedule({
                cutoff,
                phase: 'blueprint-select',
                scanCursor: candidate.continueCursor,
            });
        }
        return;
    }

    await operations.schedule({
        cutoff,
        phase: 'blueprint-executions',
        runId: candidate.runId,
        scanCursor: candidate.continueCursor,
    });
}

async function pruneBlueprintExecution(
    operations: HistoricalRetentionOperations,
    input: { cutoff: string; runId: string; scanCursor?: string }
): Promise<void> {
    const execution = await operations.loadFirstExecution(input.runId);
    if (!execution) {
        await scheduleRunPhase(operations, input, 'blueprint-actions');
        return;
    }
    if (!isDeletableStructureExecutionStatus(execution.status)) {
        await continueBlueprintScan(operations, input.cutoff, input.scanCursor);
        return;
    }

    const attemptIds = await operations.loadAttemptIds(execution.id, historicalRetentionBatchSize + 1);
    const hasMore = attemptIds.length > historicalRetentionBatchSize;
    await operations.deleteBlueprintChildIds('blueprint-attempts', attemptIds.slice(0, historicalRetentionBatchSize));

    if (!hasMore) await operations.deleteExecution(execution.id);
    await scheduleRunPhase(operations, input, 'blueprint-executions');
}

async function pruneBlueprintChildren(
    operations: HistoricalRetentionOperations,
    input: { cutoff: string; phase: BlueprintChildPhase; runId: string; scanCursor?: string }
): Promise<void> {
    const ids = await operations.loadBlueprintChildIds(input.phase, input.runId, historicalRetentionBatchSize + 1);
    const hasMore = ids.length > historicalRetentionBatchSize;
    await operations.deleteBlueprintChildIds(input.phase, ids.slice(0, historicalRetentionBatchSize));
    await scheduleRunPhase(operations, input, hasMore ? input.phase : nextBlueprintPhase(input.phase));
}

async function pruneBlueprintRun(
    operations: HistoricalRetentionOperations,
    input: { cutoff: string; runId: string; scanCursor?: string }
): Promise<void> {
    const remainingPhase = await operations.findRemainingRunPhase(input.runId);
    if (remainingPhase) {
        await scheduleRunPhase(operations, input, remainingPhase);
        return;
    }

    await operations.deleteRun(input.runId);
    await continueBlueprintScan(operations, input.cutoff, input.scanCursor);
}

async function runRemainsEligible(
    operations: HistoricalRetentionOperations,
    runId: string,
    cutoff: string
): Promise<boolean> {
    const run = await operations.loadRunState(runId);
    return (
        run !== null &&
        run.status === 'stale' &&
        run.updatedAt < cutoff &&
        !(await operations.hasProtectedExecution(runId))
    );
}

function nextBlueprintPhase(phase: BlueprintChildPhase): HistoricalRetentionPhase {
    switch (phase) {
        case 'blueprint-actions':
            return 'blueprint-decisions';
        case 'blueprint-decisions':
            return 'blueprint-approvals';
        case 'blueprint-approvals':
            return 'blueprint-preflights';
        case 'blueprint-preflights':
            return 'blueprint-run';
    }
}

async function scheduleRunPhase(
    operations: HistoricalRetentionOperations,
    input: { cutoff: string; runId: string; scanCursor?: string },
    phase: HistoricalRetentionPhase
): Promise<void> {
    await operations.schedule({
        cutoff: input.cutoff,
        phase,
        runId: input.runId,
        ...(input.scanCursor ? { scanCursor: input.scanCursor } : {}),
    });
}

async function continueBlueprintScan(
    operations: HistoricalRetentionOperations,
    cutoff: string,
    scanCursor: string | undefined
): Promise<void> {
    if (!scanCursor) return;
    await operations.schedule({ cutoff, phase: 'blueprint-select', scanCursor });
}

function createHistoricalRetentionOperations(ctx: MutationCtx): HistoricalRetentionOperations {
    return {
        claimExpiredRun: async (runId, cutoff) => {
            const typedRunId = runId as GenericId<'structureImportRuns'>;
            const run = await ctx.db.get('structureImportRuns', typedRunId);
            if (!run || run.updatedAt >= cutoff || (await hasProtectedExecution(ctx, runId))) return false;

            if (run.status !== 'stale') {
                await ctx.db.patch('structureImportRuns', typedRunId, { status: 'stale' });
            }
            return true;
        },
        deleteAuditEventIds: async (ids) => {
            for (const id of ids) await ctx.db.delete('botActionEvents', id as GenericId<'botActionEvents'>);
        },
        deleteBlueprintChildIds: async (phase, ids) => {
            for (const id of ids) await deleteBlueprintChild(ctx, phase, id);
        },
        deleteExecution: async (executionId) => {
            await ctx.db.delete('structureImportExecutions', executionId as GenericId<'structureImportExecutions'>);
        },
        deleteRun: async (runId) => {
            await ctx.db.delete('structureImportRuns', runId as GenericId<'structureImportRuns'>);
        },
        findRemainingRunPhase: async (runId) => await findRemainingRunPhase(ctx, runId),
        hasProtectedExecution: async (runId) => await hasProtectedExecution(ctx, runId),
        loadAttemptIds: async (executionId, limit) =>
            (
                await ctx.db
                    .query('structureImportActionAttempts')
                    .withIndex('by_execution_action_attempt', (index) =>
                        index.eq('executionId', executionId as GenericId<'structureImportExecutions'>)
                    )
                    .take(limit)
            ).map((row) => String(row._id)),
        loadBlueprintChildIds: async (phase, runId, limit) => await loadBlueprintChildIds(ctx, phase, runId, limit),
        loadExpiredAuditEventIds: async (cutoff, limit) =>
            (
                await ctx.db
                    .query('botActionEvents')
                    .withIndex('by_created', (index) => index.lt('createdAt', cutoff))
                    .take(limit)
            ).map((row) => String(row._id)),
        loadFirstExecution: async (runId) => {
            const execution = await ctx.db
                .query('structureImportExecutions')
                .withIndex('by_run_created', (index) => index.eq('runId', runId as GenericId<'structureImportRuns'>))
                .first();
            return execution ? { id: String(execution._id), status: execution.status } : null;
        },
        loadNextExpiredRun: async (cutoff, cursor) => {
            const page = await ctx.db
                .query('structureImportRuns')
                .withIndex('by_updated', (index) => index.lt('updatedAt', cutoff))
                .order('asc')
                .paginate({ cursor, numItems: 1 });
            return {
                continueCursor: page.continueCursor,
                isDone: page.isDone,
                runId: page.page[0] ? String(page.page[0]._id) : null,
            };
        },
        loadRunState: async (runId) => {
            const run = await ctx.db.get('structureImportRuns', runId as GenericId<'structureImportRuns'>);
            return run ? { status: run.status, updatedAt: run.updatedAt } : null;
        },
        schedule: async (continuation) => {
            await ctx.scheduler.runAfter(
                0,
                internal.retention.historical_retention.pruneHistoricalRetentionBatch,
                continuation
            );
        },
    };
}

async function hasProtectedExecution(ctx: MutationCtx, runId: string): Promise<boolean> {
    for (const status of protectedStructureExecutionStatuses) {
        const execution = await ctx.db
            .query('structureImportExecutions')
            .withIndex('by_run_status', (index) =>
                index.eq('runId', runId as GenericId<'structureImportRuns'>).eq('status', status)
            )
            .first();
        if (execution) return true;
    }
    return false;
}

async function loadBlueprintChildIds(
    ctx: MutationCtx,
    phase: BlueprintChildPhase,
    runId: string,
    limit: number
): Promise<string[]> {
    const typedRunId = runId as GenericId<'structureImportRuns'>;
    switch (phase) {
        case 'blueprint-actions':
            return (
                await ctx.db
                    .query('structureImportActions')
                    .withIndex('by_run_sequence', (index) => index.eq('runId', typedRunId))
                    .take(limit)
            ).map((row) => String(row._id));
        case 'blueprint-decisions':
            return (
                await ctx.db
                    .query('structureImportDecisions')
                    .withIndex('by_run_sequence', (index) => index.eq('runId', typedRunId))
                    .take(limit)
            ).map((row) => String(row._id));
        case 'blueprint-approvals':
            return (
                await ctx.db
                    .query('structureImportApprovals')
                    .withIndex('by_run_approved', (index) => index.eq('runId', typedRunId))
                    .take(limit)
            ).map((row) => String(row._id));
        case 'blueprint-preflights':
            return (
                await ctx.db
                    .query('structureImportPreflights')
                    .withIndex('by_run_checked', (index) => index.eq('runId', typedRunId))
                    .take(limit)
            ).map((row) => String(row._id));
    }
}

async function deleteBlueprintChild(
    ctx: MutationCtx,
    phase: BlueprintChildPhase | 'blueprint-attempts',
    id: string
): Promise<void> {
    switch (phase) {
        case 'blueprint-attempts':
            await ctx.db.delete('structureImportActionAttempts', id as GenericId<'structureImportActionAttempts'>);
            return;
        case 'blueprint-actions':
            await ctx.db.delete('structureImportActions', id as GenericId<'structureImportActions'>);
            return;
        case 'blueprint-decisions':
            await ctx.db.delete('structureImportDecisions', id as GenericId<'structureImportDecisions'>);
            return;
        case 'blueprint-approvals':
            await ctx.db.delete('structureImportApprovals', id as GenericId<'structureImportApprovals'>);
            return;
        case 'blueprint-preflights':
            await ctx.db.delete('structureImportPreflights', id as GenericId<'structureImportPreflights'>);
            return;
    }
}

async function findRemainingRunPhase(ctx: MutationCtx, runId: string): Promise<BlueprintRemainingPhase | null> {
    const typedRunId = runId as GenericId<'structureImportRuns'>;
    if (
        await ctx.db
            .query('structureImportExecutions')
            .withIndex('by_run_created', (index) => index.eq('runId', typedRunId))
            .first()
    ) {
        return 'blueprint-executions';
    }
    for (const phase of [
        'blueprint-actions',
        'blueprint-decisions',
        'blueprint-approvals',
        'blueprint-preflights',
    ] as const) {
        if ((await loadBlueprintChildIds(ctx, phase, runId, 1)).length > 0) return phase;
    }
    return null;
}
