import { v, type GenericId } from 'convex/values';

import { internal } from '../_generated/api.js';
import { internalMutation, type MutationCtx } from '../_generated/server.js';
import { dataRetentionCutoff, readDataRetentionDays } from './retention_policy.js';

export const historicalRetentionBatchSize = 100;

export const protectedBlueprintRunStatuses = [
    'queued',
    'running',
    'waiting_rate_limit',
    'pause_requested',
    'paused',
    'verifying',
    'needs_reconciliation',
    'outcome_unknown',
] as const;

export const deletableBlueprintRunStatuses = [
    'succeeded',
    'partially_applied',
    'failed_before_mutation',
    'cancelled',
] as const;

export type HistoricalRetentionPhase =
    | 'audit-events'
    | 'blueprint-plan-select'
    | 'blueprint-runs'
    | 'blueprint-plan-steps'
    | 'blueprint-plan-decisions'
    | 'blueprint-plan-approvals'
    | 'blueprint-plan-preflights'
    | 'blueprint-plan';

type BlueprintChildPhase = Exclude<
    HistoricalRetentionPhase,
    'audit-events' | 'blueprint-plan-select' | 'blueprint-runs' | 'blueprint-plan'
>;
type BlueprintRemainingPhase = Exclude<
    HistoricalRetentionPhase,
    'audit-events' | 'blueprint-plan-select' | 'blueprint-plan'
>;

export type HistoricalRetentionContinuation = {
    cutoff: string;
    phase: HistoricalRetentionPhase;
    planId?: string;
    scanCursor?: string;
};

export type HistoricalRetentionOperations = {
    claimExpiredPlan: (planId: string, cutoff: string) => Promise<boolean>;
    deleteAuditEventIds: (ids: string[]) => Promise<void>;
    deleteBlueprintChildIds: (
        phase: BlueprintChildPhase | 'blueprint-run-step-attempts',
        ids: string[]
    ) => Promise<void>;
    deleteRun: (runId: string) => Promise<void>;
    deletePlan: (planId: string) => Promise<void>;
    findRemainingPlanPhase: (planId: string) => Promise<BlueprintRemainingPhase | null>;
    hasProtectedRun: (planId: string) => Promise<boolean>;
    loadRunStepAttemptIds: (runId: string, limit: number) => Promise<string[]>;
    loadBlueprintPlanChildIds: (phase: BlueprintChildPhase, planId: string, limit: number) => Promise<string[]>;
    loadExpiredAuditEventIds: (cutoff: string, limit: number) => Promise<string[]>;
    loadFirstRun: (planId: string) => Promise<{ id: string; status: string } | null>;
    loadNextExpiredPlan: (
        cutoff: string,
        cursor: string | null
    ) => Promise<{ continueCursor: string; isDone: boolean; planId: string | null }>;
    loadPlanState: (planId: string) => Promise<{ status: string; updatedAt: string } | null>;
    schedule: (continuation: HistoricalRetentionContinuation) => Promise<void>;
};

const historicalRetentionPhaseValidator = v.union(
    v.literal('audit-events'),
    v.literal('blueprint-plan-select'),
    v.literal('blueprint-runs'),
    v.literal('blueprint-plan-steps'),
    v.literal('blueprint-plan-decisions'),
    v.literal('blueprint-plan-approvals'),
    v.literal('blueprint-plan-preflights'),
    v.literal('blueprint-plan')
);

export const pruneHistoricalRetentionBatch = internalMutation({
    args: {
        cutoff: v.optional(v.string()),
        phase: v.optional(historicalRetentionPhaseValidator),
        planId: v.optional(v.string()),
        scanCursor: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await executeHistoricalRetentionBatch(createHistoricalRetentionOperations(ctx), {
            now: new Date().toISOString(),
            ...(args.cutoff ? { cutoff: args.cutoff } : {}),
            ...(args.phase ? { phase: args.phase } : {}),
            ...(args.planId ? { planId: args.planId } : {}),
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
        planId?: string;
        scanCursor?: string;
    }
): Promise<void> {
    const cutoff = input.cutoff ?? dataRetentionCutoff(input.now, input.retentionDays ?? readDataRetentionDays());
    const phase = input.phase ?? 'audit-events';

    if (phase === 'audit-events') {
        await pruneAuditEvents(operations, cutoff);
        return;
    }

    if (phase === 'blueprint-plan-select') {
        await selectBlueprintPlan(operations, cutoff, input.scanCursor);
        return;
    }

    const planId = input.planId;
    if (!planId) throw new Error('historical-retention-plan-required');

    if (!(await planRemainsEligible(operations, planId, cutoff))) {
        await continueBlueprintScan(operations, cutoff, input.scanCursor);
        return;
    }

    if (phase === 'blueprint-runs') {
        await pruneBlueprintRun(operations, {
            cutoff,
            planId,
            ...(input.scanCursor ? { scanCursor: input.scanCursor } : {}),
        });
        return;
    }

    if (phase === 'blueprint-plan') {
        await pruneBlueprintPlan(operations, {
            cutoff,
            planId,
            ...(input.scanCursor ? { scanCursor: input.scanCursor } : {}),
        });
        return;
    }

    await pruneBlueprintChildren(operations, {
        cutoff,
        phase,
        planId,
        ...(input.scanCursor ? { scanCursor: input.scanCursor } : {}),
    });
}

export function isProtectedBlueprintRunStatus(status: string): boolean {
    return protectedBlueprintRunStatuses.includes(status as never);
}

export function isDeletableBlueprintRunStatus(status: string): boolean {
    return deletableBlueprintRunStatuses.includes(status as never);
}

async function pruneAuditEvents(operations: HistoricalRetentionOperations, cutoff: string): Promise<void> {
    const ids = await operations.loadExpiredAuditEventIds(cutoff, historicalRetentionBatchSize + 1);
    const hasMore = ids.length > historicalRetentionBatchSize;
    await operations.deleteAuditEventIds(ids.slice(0, historicalRetentionBatchSize));
    await operations.schedule({ cutoff, phase: hasMore ? 'audit-events' : 'blueprint-plan-select' });
}

async function selectBlueprintPlan(
    operations: HistoricalRetentionOperations,
    cutoff: string,
    scanCursor: string | undefined
): Promise<void> {
    const candidate = await operations.loadNextExpiredPlan(cutoff, scanCursor ?? null);
    if (!candidate.planId) return;

    if (!(await operations.claimExpiredPlan(candidate.planId, cutoff))) {
        if (!candidate.isDone) {
            await operations.schedule({
                cutoff,
                phase: 'blueprint-plan-select',
                scanCursor: candidate.continueCursor,
            });
        }
        return;
    }

    await operations.schedule({
        cutoff,
        phase: 'blueprint-runs',
        planId: candidate.planId,
        scanCursor: candidate.continueCursor,
    });
}

async function pruneBlueprintRun(
    operations: HistoricalRetentionOperations,
    input: { cutoff: string; planId: string; scanCursor?: string }
): Promise<void> {
    const run = await operations.loadFirstRun(input.planId);
    if (!run) {
        await schedulePlanPhase(operations, input, 'blueprint-plan-steps');
        return;
    }
    if (!isDeletableBlueprintRunStatus(run.status)) {
        await continueBlueprintScan(operations, input.cutoff, input.scanCursor);
        return;
    }

    const attemptIds = await operations.loadRunStepAttemptIds(run.id, historicalRetentionBatchSize + 1);
    const hasMore = attemptIds.length > historicalRetentionBatchSize;
    await operations.deleteBlueprintChildIds(
        'blueprint-run-step-attempts',
        attemptIds.slice(0, historicalRetentionBatchSize)
    );

    if (!hasMore) await operations.deleteRun(run.id);
    await schedulePlanPhase(operations, input, 'blueprint-runs');
}

async function pruneBlueprintChildren(
    operations: HistoricalRetentionOperations,
    input: { cutoff: string; phase: BlueprintChildPhase; planId: string; scanCursor?: string }
): Promise<void> {
    const ids = await operations.loadBlueprintPlanChildIds(input.phase, input.planId, historicalRetentionBatchSize + 1);
    const hasMore = ids.length > historicalRetentionBatchSize;
    await operations.deleteBlueprintChildIds(input.phase, ids.slice(0, historicalRetentionBatchSize));
    await schedulePlanPhase(operations, input, hasMore ? input.phase : nextBlueprintPhase(input.phase));
}

async function pruneBlueprintPlan(
    operations: HistoricalRetentionOperations,
    input: { cutoff: string; planId: string; scanCursor?: string }
): Promise<void> {
    const remainingPhase = await operations.findRemainingPlanPhase(input.planId);
    if (remainingPhase) {
        await schedulePlanPhase(operations, input, remainingPhase);
        return;
    }

    await operations.deletePlan(input.planId);
    await continueBlueprintScan(operations, input.cutoff, input.scanCursor);
}

async function planRemainsEligible(
    operations: HistoricalRetentionOperations,
    planId: string,
    cutoff: string
): Promise<boolean> {
    const plan = await operations.loadPlanState(planId);
    return (
        plan !== null &&
        plan.status === 'obsolete' &&
        plan.updatedAt < cutoff &&
        !(await operations.hasProtectedRun(planId))
    );
}

function nextBlueprintPhase(phase: BlueprintChildPhase): HistoricalRetentionPhase {
    switch (phase) {
        case 'blueprint-plan-steps':
            return 'blueprint-plan-decisions';
        case 'blueprint-plan-decisions':
            return 'blueprint-plan-approvals';
        case 'blueprint-plan-approvals':
            return 'blueprint-plan-preflights';
        case 'blueprint-plan-preflights':
            return 'blueprint-plan';
    }
}

async function schedulePlanPhase(
    operations: HistoricalRetentionOperations,
    input: { cutoff: string; planId: string; scanCursor?: string },
    phase: HistoricalRetentionPhase
): Promise<void> {
    await operations.schedule({
        cutoff: input.cutoff,
        phase,
        planId: input.planId,
        ...(input.scanCursor ? { scanCursor: input.scanCursor } : {}),
    });
}

async function continueBlueprintScan(
    operations: HistoricalRetentionOperations,
    cutoff: string,
    scanCursor: string | undefined
): Promise<void> {
    if (!scanCursor) return;
    await operations.schedule({ cutoff, phase: 'blueprint-plan-select', scanCursor });
}

function createHistoricalRetentionOperations(ctx: MutationCtx): HistoricalRetentionOperations {
    return {
        claimExpiredPlan: async (planId, cutoff) => {
            const typedPlanId = planId as GenericId<'blueprintPlans'>;
            const plan = await ctx.db.get('blueprintPlans', typedPlanId);
            if (!plan || plan.updatedAt >= cutoff || (await hasProtectedRun(ctx, planId))) return false;

            if (plan.status !== 'obsolete') {
                await ctx.db.patch('blueprintPlans', typedPlanId, { status: 'obsolete' });
            }
            return true;
        },
        deleteAuditEventIds: async (ids) => {
            for (const id of ids) await ctx.db.delete('botActionEvents', id as GenericId<'botActionEvents'>);
        },
        deleteBlueprintChildIds: async (phase, ids) => {
            for (const id of ids) await deleteBlueprintChild(ctx, phase, id);
        },
        deleteRun: async (runId) => {
            await ctx.db.delete('blueprintRuns', runId as GenericId<'blueprintRuns'>);
        },
        deletePlan: async (planId) => {
            await ctx.db.delete('blueprintPlans', planId as GenericId<'blueprintPlans'>);
        },
        findRemainingPlanPhase: async (planId) => await findRemainingPlanPhase(ctx, planId),
        hasProtectedRun: async (planId) => await hasProtectedRun(ctx, planId),
        loadRunStepAttemptIds: async (runId, limit) =>
            (
                await ctx.db
                    .query('blueprintRunStepAttempts')
                    .withIndex('by_run_plan_step_attempt', (index) =>
                        index.eq('runId', runId as GenericId<'blueprintRuns'>)
                    )
                    .take(limit)
            ).map((row) => String(row._id)),
        loadBlueprintPlanChildIds: async (phase, planId, limit) =>
            await loadBlueprintPlanChildIds(ctx, phase, planId, limit),
        loadExpiredAuditEventIds: async (cutoff, limit) =>
            (
                await ctx.db
                    .query('botActionEvents')
                    .withIndex('by_created', (index) => index.lt('createdAt', cutoff))
                    .take(limit)
            ).map((row) => String(row._id)),
        loadFirstRun: async (planId) => {
            const run = await ctx.db
                .query('blueprintRuns')
                .withIndex('by_plan_created', (index) => index.eq('planId', planId as GenericId<'blueprintPlans'>))
                .first();
            return run ? { id: String(run._id), status: run.status } : null;
        },
        loadNextExpiredPlan: async (cutoff, cursor) => {
            const page = await ctx.db
                .query('blueprintPlans')
                .withIndex('by_updated', (index) => index.lt('updatedAt', cutoff))
                .order('asc')
                .paginate({ cursor, numItems: 1 });
            return {
                continueCursor: page.continueCursor,
                isDone: page.isDone,
                planId: page.page[0] ? String(page.page[0]._id) : null,
            };
        },
        loadPlanState: async (planId) => {
            const plan = await ctx.db.get('blueprintPlans', planId as GenericId<'blueprintPlans'>);
            return plan ? { status: plan.status, updatedAt: plan.updatedAt } : null;
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

async function hasProtectedRun(ctx: MutationCtx, planId: string): Promise<boolean> {
    for (const status of protectedBlueprintRunStatuses) {
        const run = await ctx.db
            .query('blueprintRuns')
            .withIndex('by_plan_status', (index) =>
                index.eq('planId', planId as GenericId<'blueprintPlans'>).eq('status', status)
            )
            .first();
        if (run) return true;
    }
    return false;
}

async function loadBlueprintPlanChildIds(
    ctx: MutationCtx,
    phase: BlueprintChildPhase,
    planId: string,
    limit: number
): Promise<string[]> {
    const typedPlanId = planId as GenericId<'blueprintPlans'>;
    switch (phase) {
        case 'blueprint-plan-steps':
            return (
                await ctx.db
                    .query('blueprintPlanSteps')
                    .withIndex('by_plan_sequence', (index) => index.eq('planId', typedPlanId))
                    .take(limit)
            ).map((row) => String(row._id));
        case 'blueprint-plan-decisions':
            return (
                await ctx.db
                    .query('blueprintPlanDecisions')
                    .withIndex('by_plan_sequence', (index) => index.eq('planId', typedPlanId))
                    .take(limit)
            ).map((row) => String(row._id));
        case 'blueprint-plan-approvals':
            return (
                await ctx.db
                    .query('blueprintPlanApprovals')
                    .withIndex('by_plan_approved', (index) => index.eq('planId', typedPlanId))
                    .take(limit)
            ).map((row) => String(row._id));
        case 'blueprint-plan-preflights':
            return (
                await ctx.db
                    .query('blueprintPlanPreflights')
                    .withIndex('by_plan_checked', (index) => index.eq('planId', typedPlanId))
                    .take(limit)
            ).map((row) => String(row._id));
    }
}

async function deleteBlueprintChild(
    ctx: MutationCtx,
    phase: BlueprintChildPhase | 'blueprint-run-step-attempts',
    id: string
): Promise<void> {
    switch (phase) {
        case 'blueprint-run-step-attempts':
            await ctx.db.delete('blueprintRunStepAttempts', id as GenericId<'blueprintRunStepAttempts'>);
            return;
        case 'blueprint-plan-steps':
            await ctx.db.delete('blueprintPlanSteps', id as GenericId<'blueprintPlanSteps'>);
            return;
        case 'blueprint-plan-decisions':
            await ctx.db.delete('blueprintPlanDecisions', id as GenericId<'blueprintPlanDecisions'>);
            return;
        case 'blueprint-plan-approvals':
            await ctx.db.delete('blueprintPlanApprovals', id as GenericId<'blueprintPlanApprovals'>);
            return;
        case 'blueprint-plan-preflights':
            await ctx.db.delete('blueprintPlanPreflights', id as GenericId<'blueprintPlanPreflights'>);
            return;
    }
}

async function findRemainingPlanPhase(ctx: MutationCtx, planId: string): Promise<BlueprintRemainingPhase | null> {
    const typedPlanId = planId as GenericId<'blueprintPlans'>;
    if (
        await ctx.db
            .query('blueprintRuns')
            .withIndex('by_plan_created', (index) => index.eq('planId', typedPlanId))
            .first()
    ) {
        return 'blueprint-runs';
    }
    for (const phase of [
        'blueprint-plan-steps',
        'blueprint-plan-decisions',
        'blueprint-plan-approvals',
        'blueprint-plan-preflights',
    ] as const) {
        if ((await loadBlueprintPlanChildIds(ctx, phase, planId, 1)).length > 0) return phase;
    }
    return null;
}
