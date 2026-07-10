import { v, type GenericId } from 'convex/values';

import { mutation, query, type MutationCtx } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { structureExecutionLiveAreas } from '../core/dashboard_live_model.js';
import { auditInputValidator, recordStructureAuditInMutation } from './structure.js';
import {
    isStructureImportDecisionLedgerComplete,
    resolveStructureExecutionIdMap,
    validateStructureImportDecisionSequences,
} from './structure_model.js';

const planStatuses = ['building', 'needs_mapping', 'review_ready', 'approved', 'stale'] as const;
const planTransitions: Record<string, readonly string[]> = {
    building: ['needs_mapping', 'review_ready', 'stale'],
    review_ready: ['approved', 'stale'],
    approved: ['stale'],
};
const activeStatuses = ['queued', 'running', 'waiting_rate_limit', 'pause_requested', 'paused', 'verifying'] as const;

export const recordStructureImportDecisionsBatch = mutation({
    args: {
        decisions: v.array(
            v.object({
                classification: v.string(),
                details: v.any(),
                logicalId: v.optional(v.string()),
                name: v.optional(v.string()),
                sequence: v.number(),
                sourceId: v.optional(v.string()),
                targetId: v.optional(v.string()),
                targetType: v.string(),
            })
        ),
        now: v.string(),
        runId: v.id('structureImportRuns'),
    },
    returns: v.array(v.any()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        if (args.decisions.length < 1 || args.decisions.length > 100)
            throw new Error('structure-decisions-batch-invalid');
        const run = await ctx.db.get('structureImportRuns', args.runId);
        if (run?.status !== 'building') throw new Error('structure-decisions-run-not-building');
        const sequences = args.decisions.map((decision) => decision.sequence);
        if (validateStructureImportDecisionSequences(sequences) !== null) {
            throw new Error('structure-decisions-sequence-invalid');
        }
        const minSequence = Math.min(...sequences);
        const maxSequence = Math.max(...sequences);
        const latest = await ctx.db
            .query('structureImportDecisions')
            .withIndex('by_run_sequence', (q) => q.eq('runId', args.runId))
            .order('desc')
            .first();
        const existing = await ctx.db
            .query('structureImportDecisions')
            .withIndex('by_run_sequence', (q) =>
                q.eq('runId', args.runId).gte('sequence', minSequence).lte('sequence', maxSequence)
            )
            .take(maxSequence - minSequence + 1);
        if (
            validateStructureImportDecisionSequences(
                sequences,
                existing.map((decision) => decision.sequence),
                latest ? latest.sequence + 1 : 0
            ) !== null
        )
            throw new Error('structure-decisions-sequence-not-append');
        const records = [];
        for (const decision of args.decisions) {
            const document = { ...decision, createdAt: args.now, runId: args.runId };
            const id = await ctx.db.insert('structureImportDecisions', document);
            records.push({ ...document, id });
        }
        return records;
    },
});

export const transitionStructureImportPlanState = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        expectedStatus: v.union(...planStatuses.map((status) => v.literal(status))),
        now: v.string(),
        runId: v.id('structureImportRuns'),
        status: v.union(...planStatuses.map((status) => v.literal(status))),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const run = await ctx.db.get('structureImportRuns', args.runId);
        if (!run) throw new Error('structure-run-not-found');
        if (run.status !== args.expectedStatus) throw new Error('structure-plan-state-conflict');
        if (!planTransitions[run.status]?.includes(args.status)) throw new Error('structure-plan-transition-invalid');
        if (args.status === 'review_ready') {
            const decisions = await ctx.db
                .query('structureImportDecisions')
                .withIndex('by_run_sequence', (q) => q.eq('runId', args.runId))
                .order('asc')
                .collect();
            if (!isStructureImportDecisionLedgerComplete(run.plan, decisions)) {
                throw new Error('structure-decisions-incomplete');
            }
        }
        await ctx.db.patch('structureImportRuns', run._id, { status: args.status, updatedAt: args.now });
        await recordStructureAuditInMutation(
            ctx,
            run.guildId,
            args.audit ?? (args.status === 'review_ready' ? { action: 'structure.import_plan_created' } : undefined),
            args.now,
            String(run._id)
        );
        return { ...run, status: args.status, updatedAt: args.now, id: run._id };
    },
});

export const listStructureImportDecisionsPage = query({
    args: {
        cursor: v.optional(v.number()),
        guildId: v.string(),
        limit: v.number(),
        runId: v.id('structureImportRuns'),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const run = await ctx.db.get('structureImportRuns', args.runId);
        if (run?.guildId !== args.guildId) return { decisions: [], nextCursor: null };
        const limit = Math.min(Math.max(Math.trunc(args.limit), 1), 100);
        const decisions = await ctx.db
            .query('structureImportDecisions')
            .withIndex('by_run_sequence', (q) =>
                args.cursor === undefined
                    ? q.eq('runId', args.runId)
                    : q.eq('runId', args.runId).gt('sequence', args.cursor)
            )
            .order('asc')
            .take(limit + 1);
        const page = decisions.slice(0, limit);
        return {
            decisions: page.map((decision) => ({ ...decision, id: decision._id })),
            nextCursor: decisions.length > page.length ? (page.at(-1)?.sequence ?? null) : null,
        };
    },
});

export const findLatestStructureImportPreflight = query({
    args: { guildId: v.string(), runId: v.id('structureImportRuns') },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const run = await ctx.db.get('structureImportRuns', args.runId);
        if (run?.guildId !== args.guildId) return null;
        return ctx.db
            .query('structureImportPreflights')
            .withIndex('by_run_checked', (q) => q.eq('runId', args.runId))
            .order('desc')
            .first();
    },
});

export const findLatestStructureImportApproval = query({
    args: { guildId: v.string(), runId: v.id('structureImportRuns') },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const run = await ctx.db.get('structureImportRuns', args.runId);
        if (run?.guildId !== args.guildId) return null;
        return ctx.db
            .query('structureImportApprovals')
            .withIndex('by_run_approved', (q) => q.eq('runId', args.runId))
            .order('desc')
            .first();
    },
});

export const findLatestStructureImportExecution = query({
    args: { guildId: v.string(), runId: v.id('structureImportRuns') },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const run = await ctx.db.get('structureImportRuns', args.runId);
        if (run?.guildId !== args.guildId) return null;
        return ctx.db
            .query('structureImportExecutions')
            .withIndex('by_run_created', (q) => q.eq('runId', args.runId))
            .order('desc')
            .first();
    },
});

export const recordStructureImportPreflight = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        checkedAt: v.string(),
        expiresAt: v.string(),
        liveFingerprint: v.string(),
        planDigest: v.string(),
        preflightDigest: v.string(),
        report: v.any(),
        runId: v.id('structureImportRuns'),
        status: v.union(v.literal('ready'), v.literal('blocked'), v.literal('stale')),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const run = await ctx.db.get('structureImportRuns', args.runId);
        if (run?.planDigest !== args.planDigest) throw new Error('structure-preflight-plan-stale');
        if (run.status !== 'approved' || args.expiresAt <= args.checkedAt)
            throw new Error('structure-preflight-state-invalid');
        const { audit, ...document } = args;
        const id = await ctx.db.insert('structureImportPreflights', document);
        await recordStructureAuditInMutation(
            ctx,
            run.guildId,
            audit ?? { action: 'structure.import_preflight_checked' },
            args.checkedAt,
            String(run._id)
        );
        return { id, ...document };
    },
});

export const approveStructureImportPlan = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        approvedAt: v.string(),
        approvedByUserId: v.optional(v.string()),
        deleteSetDigest: v.optional(v.string()),
        destructiveActionCount: v.optional(v.number()),
        destructiveApprovedAt: v.optional(v.string()),
        destructivePreflightDigest: v.optional(v.string()),
        planDigest: v.string(),
        runId: v.id('structureImportRuns'),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const run = await ctx.db.get('structureImportRuns', args.runId);
        if (run?.planDigest !== args.planDigest) {
            throw new Error('structure-approval-plan-stale');
        }
        const isDestructiveApproval = Boolean(args.destructiveApprovedAt);
        if (
            !isDestructiveApproval &&
            (args.deleteSetDigest || args.destructiveActionCount !== undefined || args.destructivePreflightDigest)
        ) {
            throw new Error('structure-approval-destructive-fields-invalid');
        }
        if (
            (!isDestructiveApproval && run.status !== 'review_ready') ||
            (isDestructiveApproval && run.status !== 'approved')
        ) {
            throw new Error('structure-approval-state-conflict');
        }
        if (args.destructiveApprovedAt) {
            if (
                run.deleteActionCount <= 0 ||
                run.deleteSetDigest !== args.deleteSetDigest ||
                run.deleteActionCount !== args.destructiveActionCount
            )
                throw new Error('structure-approval-delete-set-stale');
            const preflight = await latestPreflight(ctx, args.runId);
            if (
                !preflight ||
                preflight.preflightDigest !== args.destructivePreflightDigest ||
                preflight.status !== 'ready'
            ) {
                throw new Error('structure-approval-preflight-stale');
            }
        }
        const { audit, ...approvalDocument } = args;
        const id = await ctx.db.insert('structureImportApprovals', approvalDocument);
        if (!isDestructiveApproval) {
            await ctx.db.patch('structureImportRuns', run._id, { status: 'approved', updatedAt: args.approvedAt });
        }
        await recordStructureAuditInMutation(
            ctx,
            run.guildId,
            audit ?? { action: 'structure.import_plan_approved' },
            args.approvedAt,
            String(run._id)
        );
        return { id, ...args };
    },
});

export const enqueueStructureImportExecution = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        now: v.string(),
        preflightDigest: v.string(),
        runId: v.id('structureImportRuns'),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const run = await ctx.db.get('structureImportRuns', args.runId);
        if (!run) throw new Error('structure-run-not-found');
        if (run.status !== 'approved') throw new Error('structure-execution-plan-not-approved');
        const preflight = await latestPreflight(ctx, args.runId);
        const approval = await ctx.db
            .query('structureImportApprovals')
            .withIndex('by_run_approved', (q) => q.eq('runId', args.runId))
            .order('desc')
            .first();
        if (
            !preflight ||
            !approval ||
            preflight.status !== 'ready' ||
            preflight.planDigest !== run.planDigest ||
            preflight.preflightDigest !== args.preflightDigest ||
            preflight.expiresAt <= args.now ||
            approval.planDigest !== run.planDigest ||
            (run.deleteActionCount > 0 &&
                (approval.deleteSetDigest !== run.deleteSetDigest ||
                    approval.destructiveActionCount !== run.deleteActionCount ||
                    approval.destructivePreflightDigest !== preflight.preflightDigest ||
                    !approval.destructiveApprovedAt))
        ) {
            throw new Error('structure-execution-review-stale');
        }
        if (await findActiveGuildExecution(ctx, run.guildId)) throw new Error('structure-guild-execution-active');
        const plannedActions = await ctx.db
            .query('structureImportActions')
            .withIndex('by_run_sequence', (q) => q.eq('runId', args.runId))
            .collect();
        const totalActions = plannedActions.length;
        const totalMutationSteps = plannedActions.reduce((total, action) => {
            const declared = objectValue(action.details)?.mutationSteps;
            return (
                total +
                (typeof declared === 'number' && Number.isInteger(declared) && declared >= 0
                    ? declared
                    : estimateActionMutationSteps(action))
            );
        }, 0);
        const document = {
            appliedActions: 0,
            completedMutationSteps: 0,
            createdAt: args.now,
            failedActions: 0,
            guildId: run.guildId,
            idMap: resolveStructureExecutionIdMap(run.plan),
            nextActionSequence: 0,
            notStartedActions: totalActions,
            phase: 'queued' as const,
            preflightDigest: preflight.preflightDigest,
            runId: args.runId,
            status: 'queued' as const,
            skippedActions: 0,
            totalActions,
            totalMutationSteps,
            updatedAt: args.now,
        };
        const id = await ctx.db.insert('structureImportExecutions', document);
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: structureExecutionLiveAreas,
            guildId: run.guildId,
            now: args.now,
        });
        await recordStructureAuditInMutation(
            ctx,
            run.guildId,
            args.audit ?? { action: 'structure.import_execution_queued' },
            args.now,
            String(id)
        );
        return { id, ...document };
    },
});

async function latestPreflight(ctx: MutationCtx, runId: GenericId<'structureImportRuns'>) {
    return ctx.db
        .query('structureImportPreflights')
        .withIndex('by_run_checked', (q) => q.eq('runId', runId))
        .order('desc')
        .first();
}

function estimateActionMutationSteps(action: { actionType: string; details: unknown; targetType: string }): number {
    if (action.actionType === 'noop') return 0;
    if (action.targetType === 'channel-order' || action.targetType === 'role-order') return 1;
    if (action.actionType === 'create') {
        const after = objectValue(action.details)?.after;
        const overwrites = objectValue(after)?.permissionOverwrites;
        return 1 + (Array.isArray(overwrites) ? overwrites.length : 0);
    }
    if (action.actionType !== 'update' || action.targetType === 'role') return 1;
    const changes = objectValue(action.details)?.changes;
    if (!Array.isArray(changes)) return 1;
    let steps = changes.some((change) => {
        const field = objectValue(change)?.field;
        return field === 'name' || field === 'parentId' || field === 'position';
    })
        ? 1
        : 0;
    const overwriteChange = changes.map(objectValue).find((change) => change?.field === 'permissionOverwrites');
    const before = Array.isArray(overwriteChange?.before)
        ? overwriteChange.before
              .map(objectValue)
              .filter((overwrite): overwrite is Record<string, unknown> => overwrite !== undefined)
        : [];
    const after = Array.isArray(overwriteChange?.after)
        ? overwriteChange.after
              .map(objectValue)
              .filter((overwrite): overwrite is Record<string, unknown> => overwrite !== undefined)
        : [];
    const afterIds = new Set(
        after.map((overwrite) => overwrite.id).filter((id): id is string => typeof id === 'string')
    );
    steps += before.filter((overwrite) => typeof overwrite.id === 'string' && !afterIds.has(overwrite.id)).length;
    steps += after.filter((overwrite) => {
        if (typeof overwrite.id !== 'string') return false;
        const previous = before.find((candidate) => candidate.id === overwrite.id);
        return (
            !previous ||
            previous.allow !== overwrite.allow ||
            previous.deny !== overwrite.deny ||
            previous.type !== overwrite.type
        );
    }).length;
    return steps;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

async function findActiveGuildExecution(ctx: MutationCtx, guildId: string) {
    for (const status of activeStatuses) {
        const execution = await ctx.db
            .query('structureImportExecutions')
            .withIndex('by_guild_status', (q) => q.eq('guildId', guildId).eq('status', status))
            .first();
        if (execution) return execution;
    }
    return null;
}
