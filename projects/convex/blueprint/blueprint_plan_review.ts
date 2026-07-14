import {
    isBlueprintPreflightReportReady,
    normalizeBlueprintPreflightReport,
} from '@neonflux/blueprint/preflight-report';
import { v, type GenericId } from 'convex/values';

import { mutation, query, type MutationCtx } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { blueprintRunLiveAreas } from '../core/dashboard_live_model.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { auditInputValidator, recordBlueprintAuditInMutation } from './blueprint.js';
import { assertBlueprintRunPlanLedger } from './blueprint_run_ledger.js';
import { assertCurrentBlueprintRunProtocol } from './blueprint_run_protocol.js';
import {
    isBlueprintPlanDecisionLedgerComplete,
    isBlueprintRunRetryPreflightFresh,
    resolveBlueprintRunIdMap,
    validateBlueprintPlanDecisionSequences,
} from './blueprint_model.js';

const planStatuses = ['draft', 'needs_input', 'review_ready', 'approved', 'obsolete'] as const;
const planTransitions: Record<string, readonly string[]> = {
    draft: ['needs_input', 'review_ready', 'obsolete'],
    needs_input: ['draft', 'review_ready', 'obsolete'],
    review_ready: ['approved', 'obsolete'],
    approved: ['obsolete'],
};
const activeStatuses = ['queued', 'running', 'waiting_rate_limit', 'pause_requested', 'paused', 'verifying'] as const;

export const recordBlueprintPlanDecisionsBatch = mutation({
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
        planId: v.id('blueprintPlans'),
    },
    returns: v.array(v.any()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        if (args.decisions.length < 1 || args.decisions.length > 100)
            throw new Error('blueprint-plan-decisions-batch-invalid');
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (plan?.status !== 'draft') throw new Error('blueprint-plan-decisions-plan-not-draft');
        const sequences = args.decisions.map((decision) => decision.sequence);
        if (validateBlueprintPlanDecisionSequences(sequences) !== null) {
            throw new Error('blueprint-plan-decisions-sequence-invalid');
        }
        const minSequence = Math.min(...sequences);
        const maxSequence = Math.max(...sequences);
        const latest = await ctx.db
            .query('blueprintPlanDecisions')
            .withIndex('by_plan_sequence', (q) => q.eq('planId', args.planId))
            .order('desc')
            .first();
        const existing = await ctx.db
            .query('blueprintPlanDecisions')
            .withIndex('by_plan_sequence', (q) =>
                q.eq('planId', args.planId).gte('sequence', minSequence).lte('sequence', maxSequence)
            )
            .take(maxSequence - minSequence + 1);
        if (
            validateBlueprintPlanDecisionSequences(
                sequences,
                existing.map((decision) => decision.sequence),
                latest ? latest.sequence + 1 : 0
            ) !== null
        )
            throw new Error('blueprint-plan-decisions-sequence-not-append');
        const records = [];
        for (const decision of args.decisions) {
            const document = { ...decision, createdAt: args.now, planId: args.planId };
            const id = await ctx.db.insert('blueprintPlanDecisions', document);
            records.push({ ...document, id });
        }
        return records;
    },
});

export const transitionBlueprintPlanState = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        expectedStatus: v.union(...planStatuses.map((status) => v.literal(status))),
        now: v.string(),
        planId: v.id('blueprintPlans'),
        status: v.union(...planStatuses.map((status) => v.literal(status))),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (!plan) throw new Error('blueprint-plan-not-found');
        if (plan.status !== args.expectedStatus) throw new Error('blueprint-plan-state-conflict');
        if (!planTransitions[plan.status]?.includes(args.status)) throw new Error('blueprint-plan-transition-invalid');
        if (args.status === 'review_ready') {
            const decisions = await ctx.db
                .query('blueprintPlanDecisions')
                .withIndex('by_plan_sequence', (q) => q.eq('planId', args.planId))
                .order('asc')
                .collect();
            if (!isBlueprintPlanDecisionLedgerComplete(plan.plan, decisions)) {
                throw new Error('blueprint-plan-decisions-incomplete');
            }
        }
        await ctx.db.patch('blueprintPlans', plan._id, { status: args.status, updatedAt: args.now });
        await recordBlueprintAuditInMutation(
            ctx,
            plan.guildId,
            args.audit ?? (args.status === 'review_ready' ? { action: 'blueprint.plan_created' } : undefined),
            args.now,
            String(plan._id)
        );
        return { ...plan, status: args.status, updatedAt: args.now, id: plan._id };
    },
});

export const listBlueprintPlanDecisionsPage = query({
    args: {
        cursor: v.optional(v.number()),
        guildId: v.string(),
        limit: v.number(),
        planId: v.id('blueprintPlans'),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (plan?.guildId !== args.guildId) return { decisions: [], nextCursor: null };
        const limit = Math.min(Math.max(Math.trunc(args.limit), 1), 100);
        const decisions = await ctx.db
            .query('blueprintPlanDecisions')
            .withIndex('by_plan_sequence', (q) =>
                args.cursor === undefined
                    ? q.eq('planId', args.planId)
                    : q.eq('planId', args.planId).gt('sequence', args.cursor)
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

export const findLatestBlueprintPlanPreflight = query({
    args: { guildId: v.string(), planId: v.id('blueprintPlans') },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (plan?.guildId !== args.guildId) return null;
        return ctx.db
            .query('blueprintPlanPreflights')
            .withIndex('by_plan_checked', (q) => q.eq('planId', args.planId))
            .order('desc')
            .first();
    },
});

export const findLatestBlueprintPlanApproval = query({
    args: { guildId: v.string(), planId: v.id('blueprintPlans') },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (plan?.guildId !== args.guildId) return null;
        return ctx.db
            .query('blueprintPlanApprovals')
            .withIndex('by_plan_approved', (q) => q.eq('planId', args.planId))
            .order('desc')
            .first();
    },
});

export const findLatestBlueprintRunForPlan = query({
    args: { guildId: v.string(), planId: v.id('blueprintPlans') },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (plan?.guildId !== args.guildId) return null;
        return ctx.db
            .query('blueprintRuns')
            .withIndex('by_plan_created', (q) => q.eq('planId', args.planId))
            .order('desc')
            .first();
    },
});

export const findActiveBlueprintRun = query({
    args: { guildId: v.string() },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const candidates = await Promise.all(
            activeStatuses.map((status) =>
                ctx.db
                    .query('blueprintRuns')
                    .withIndex('by_guild_status', (q) => q.eq('guildId', args.guildId).eq('status', status))
                    .order('desc')
                    .first()
            )
        );

        return (
            candidates
                .filter((candidate) => candidate !== null)
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
        );
    },
});

export const recordBlueprintPlanPreflight = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        checkedAt: v.string(),
        expiresAt: v.string(),
        liveFingerprint: v.string(),
        planDigest: v.string(),
        preflightDigest: v.string(),
        report: v.any(),
        planId: v.id('blueprintPlans'),
        status: v.union(v.literal('ready'), v.literal('blocked'), v.literal('stale')),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (plan?.planDigest !== args.planDigest) throw new Error('blueprint-plan-preflight-stale');
        if (plan.status !== 'approved' || args.expiresAt <= args.checkedAt)
            throw new Error('blueprint-plan-preflight-state-invalid');
        const report = normalizeBlueprintPreflightReport(args.report);
        if (report.type === 'invalid') throw new Error('blueprint-plan-preflight-report-invalid');
        if ((args.status === 'ready') !== isBlueprintPreflightReportReady(report.value)) {
            throw new Error('blueprint-plan-preflight-state-invalid');
        }
        const document = {
            checkedAt: args.checkedAt,
            expiresAt: args.expiresAt,
            liveFingerprint: args.liveFingerprint,
            planDigest: args.planDigest,
            preflightDigest: args.preflightDigest,
            report: report.value,
            planId: args.planId,
            status: args.status,
        };
        const id = await ctx.db.insert('blueprintPlanPreflights', document);
        await recordBlueprintAuditInMutation(
            ctx,
            plan.guildId,
            args.audit ?? { action: 'blueprint.plan_preflight_checked' },
            args.checkedAt,
            String(plan._id)
        );
        return { id, ...document };
    },
});

export const approveBlueprintPlan = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        approvedAt: v.string(),
        approvedByUserId: v.optional(v.string()),
        deleteSetDigest: v.optional(v.string()),
        destructiveStepCount: v.optional(v.number()),
        destructiveApprovedAt: v.optional(v.string()),
        destructivePreflightDigest: v.optional(v.string()),
        planDigest: v.string(),
        planId: v.id('blueprintPlans'),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (plan?.planDigest !== args.planDigest) {
            throw new Error('blueprint-plan-approval-stale');
        }
        const isDestructiveApproval = Boolean(args.destructiveApprovedAt);
        if (
            !isDestructiveApproval &&
            (args.deleteSetDigest || args.destructiveStepCount !== undefined || args.destructivePreflightDigest)
        ) {
            throw new Error('blueprint-plan-approval-destructive-fields-invalid');
        }
        if (
            (!isDestructiveApproval && plan.status !== 'review_ready') ||
            (isDestructiveApproval && plan.status !== 'approved')
        ) {
            throw new Error('blueprint-plan-approval-state-conflict');
        }
        if (args.destructiveApprovedAt) {
            if (
                plan.deleteStepCount <= 0 ||
                plan.deleteSetDigest !== args.deleteSetDigest ||
                plan.deleteStepCount !== args.destructiveStepCount
            )
                throw new Error('blueprint-plan-approval-delete-set-stale');
            const preflight = await latestPreflight(ctx, args.planId);
            if (
                !preflight ||
                preflight.preflightDigest !== args.destructivePreflightDigest ||
                preflight.status !== 'ready'
            ) {
                throw new Error('blueprint-plan-approval-preflight-stale');
            }
        }
        const { audit, ...approvalDocument } = args;
        const id = await ctx.db.insert('blueprintPlanApprovals', approvalDocument);
        if (!isDestructiveApproval) {
            await ctx.db.patch('blueprintPlans', plan._id, { status: 'approved', updatedAt: args.approvedAt });
        }
        await recordBlueprintAuditInMutation(
            ctx,
            plan.guildId,
            audit ?? { action: 'blueprint.plan_approved' },
            args.approvedAt,
            String(plan._id)
        );
        return { id, ...args };
    },
});

export const enqueueBlueprintRun = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        now: v.string(),
        preflightDigest: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        planId: v.id('blueprintPlans'),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (!plan) throw new Error('blueprint-plan-not-found');
        if (plan.status !== 'approved') throw new Error('blueprint-run-plan-not-approved');
        const preflight = await latestPreflight(ctx, args.planId);
        const approval = await ctx.db
            .query('blueprintPlanApprovals')
            .withIndex('by_plan_approved', (q) => q.eq('planId', args.planId))
            .order('desc')
            .first();
        const latestRun = await ctx.db
            .query('blueprintRuns')
            .withIndex('by_plan_created', (q) => q.eq('planId', args.planId))
            .order('desc')
            .first();
        if (
            !preflight ||
            !approval ||
            preflight.status !== 'ready' ||
            preflight.planDigest !== plan.planDigest ||
            preflight.preflightDigest !== args.preflightDigest ||
            preflight.expiresAt <= args.now ||
            !isBlueprintRunRetryPreflightFresh({
                latestRun,
                preflightCheckedAt: preflight.checkedAt,
            }) ||
            approval.planDigest !== plan.planDigest ||
            (plan.deleteStepCount > 0 &&
                (approval.deleteSetDigest !== plan.deleteSetDigest ||
                    approval.destructiveStepCount !== plan.deleteStepCount ||
                    approval.destructivePreflightDigest !== preflight.preflightDigest ||
                    !approval.destructiveApprovedAt))
        ) {
            throw new Error('blueprint-run-review-stale');
        }
        const activeRun = await findActiveGuildRun(ctx, plan.guildId);
        if (activeRun) {
            assertCurrentBlueprintRunProtocol(activeRun);
            throw new Error('blueprint-guild-run-active');
        }
        const plannedSteps = await ctx.db
            .query('blueprintPlanSteps')
            .withIndex('by_plan_sequence', (q) => q.eq('planId', args.planId))
            .collect();
        await assertBlueprintRunPlanLedger(plan, plannedSteps);
        const totalSteps = plannedSteps.length;
        if (totalSteps === 0) throw new Error('blueprint-run-empty');
        const totalMutationSteps = totalSteps;
        const document = {
            appliedSteps: 0,
            completedMutationSteps: 0,
            createdAt: args.now,
            failedSteps: 0,
            guildId: plan.guildId,
            idMap: resolveBlueprintRunIdMap(plan.plan),
            nextStepSequence: 0,
            notStartedSteps: totalSteps,
            phase: 'queued' as const,
            preflightDigest: preflight.preflightDigest,
            preflightExpiresAt: preflight.expiresAt,
            preflightLiveFingerprint: preflight.liveFingerprint,
            protocolVersion: args.protocolVersion,
            planId: args.planId,
            status: 'queued' as const,
            skippedSteps: 0,
            totalSteps,
            totalMutationSteps,
            updatedAt: args.now,
        };
        const id = await ctx.db.insert('blueprintRuns', document);
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: blueprintRunLiveAreas,
            guildId: plan.guildId,
            now: args.now,
        });
        await recordBlueprintAuditInMutation(
            ctx,
            plan.guildId,
            args.audit ?? { action: 'blueprint.run_queued' },
            args.now,
            String(id)
        );
        return { id, ...document };
    },
});

async function latestPreflight(ctx: MutationCtx, planId: GenericId<'blueprintPlans'>) {
    return ctx.db
        .query('blueprintPlanPreflights')
        .withIndex('by_plan_checked', (q) => q.eq('planId', planId))
        .order('desc')
        .first();
}

async function findActiveGuildRun(ctx: MutationCtx, guildId: string) {
    for (const status of activeStatuses) {
        const run = await ctx.db
            .query('blueprintRuns')
            .withIndex('by_guild_status', (q) => q.eq('guildId', guildId).eq('status', status))
            .first();
        if (run) return run;
    }
    return null;
}
