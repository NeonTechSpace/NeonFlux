import { canonicalJsonStringify } from '@neonflux/blueprint/canonical-json';
import { normalizeBlueprintPlanDecision, normalizeBlueprintPlanStep } from '@neonflux/blueprint/runtime-contracts';
import { getDocumentSize, v, type GenericId, type Infer, type Value } from 'convex/values';

import type { MutationCtx, QueryCtx } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import {
    assertDocumentSize,
    MAX_PLAN_LEDGER_BYTES,
    MAX_PLAN_STEP_BYTES,
    requireTimestamp,
} from './blueprint_plan_persistence_values.js';

const stepEntryValidator = v.object({ sequence: v.number(), step: v.any() });
const decisionEntryValidator = v.object({ sequence: v.number(), decision: v.any() });

export const planStepRecordValidator = v.object({
    createdAt: v.string(),
    id: v.string(),
    planId: v.string(),
    sequence: v.number(),
    step: v.any(),
});

export const planDecisionRecordValidator = v.object({
    createdAt: v.string(),
    decision: v.any(),
    id: v.string(),
    planId: v.string(),
    sequence: v.number(),
});

export const blueprintPlanStepBatchArgs = {
    now: v.string(),
    planId: v.id('blueprintPlans'),
    steps: v.array(stepEntryValidator),
};

export const blueprintPlanDecisionBatchArgs = {
    decisions: v.array(decisionEntryValidator),
    now: v.string(),
    planId: v.id('blueprintPlans'),
};

export const blueprintPlanStepPageArgs = {
    cursor: v.optional(v.union(v.string(), v.null())),
    guildId: v.string(),
    limit: v.optional(v.number()),
    planId: v.id('blueprintPlans'),
};

type BlueprintPlanStepBatchArgs = Infer<ReturnType<typeof v.object<typeof blueprintPlanStepBatchArgs>>>;
type BlueprintPlanDecisionBatchArgs = Infer<ReturnType<typeof v.object<typeof blueprintPlanDecisionBatchArgs>>>;
type BlueprintPlanStepPageArgs = Infer<ReturnType<typeof v.object<typeof blueprintPlanStepPageArgs>>>;

export async function writeBlueprintPlanStepBatchHandler(ctx: MutationCtx, args: BlueprintPlanStepBatchArgs) {
    await requireNeonFluxService(ctx, ['web']);
    const now = requireTimestamp(args.now, 'blueprint-plan-step-created-at-invalid');
    const plan = await requireDraftPlan(ctx, args.planId);
    if (args.steps.length < 1 || args.steps.length > 100) throw new Error('blueprint-plan-step-batch-size-invalid');
    const entries = args.steps.map((entry) => {
        const normalized = normalizeBlueprintPlanStep(entry.step);
        if (normalized.type === 'invalid') throw new Error('blueprint-plan-step-invalid');
        return { sequence: entry.sequence, step: normalized.value };
    });
    assertContiguousBatch(entries, plan.stepCount, 'blueprint-plan-step-sequence-invalid');
    const existing = await readStepSequenceRange(ctx, args.planId, entries);
    if (existing.length > 0) {
        if (
            existing.length !== entries.length ||
            existing.some(
                (record, index) =>
                    record.sequence !== entries[index]?.sequence ||
                    canonicalJsonStringify(record.step) !== canonicalJsonStringify(entries[index].step)
            )
        ) {
            throw new Error('blueprint-plan-step-batch-conflict');
        }
        return existing.map(toPlanStepRecord);
    }
    await requireStepAppendPosition(ctx, args.planId, entries[0]?.sequence ?? 0);
    const batchBytes = entries.reduce(
        (total, entry) => total + getDocumentSize({ ...entry, planId: args.planId, createdAt: now }),
        0
    );
    if (plan.stepLedgerBytes + plan.decisionLedgerBytes + batchBytes > MAX_PLAN_LEDGER_BYTES) {
        throw new Error('blueprint-plan-ledger-too-large');
    }
    const records = [];
    for (const entry of entries) {
        const document = { ...entry, planId: args.planId, createdAt: now };
        assertDocumentSize(document, MAX_PLAN_STEP_BYTES, 'blueprint-plan-step-too-large');
        const id = await ctx.db.insert('blueprintPlanSteps', document);
        records.push({ id, planId: args.planId, createdAt: now, ...entry });
    }
    await ctx.db.patch('blueprintPlans', plan._id, {
        stepLedgerBytes: plan.stepLedgerBytes + batchBytes,
        updatedAt: now,
    });
    return records;
}

export async function writeBlueprintPlanDecisionBatchHandler(ctx: MutationCtx, args: BlueprintPlanDecisionBatchArgs) {
    await requireNeonFluxService(ctx, ['web']);
    const now = requireTimestamp(args.now, 'blueprint-plan-decision-created-at-invalid');
    const plan = await requireDraftPlan(ctx, args.planId);
    if (args.decisions.length < 1 || args.decisions.length > 100) {
        throw new Error('blueprint-plan-decision-batch-size-invalid');
    }
    const entries = args.decisions.map((entry) => {
        const normalized = normalizeBlueprintPlanDecision(entry.decision);
        if (normalized.type === 'invalid') throw new Error('blueprint-plan-decision-invalid');
        return { sequence: entry.sequence, decision: normalized.value };
    });
    assertContiguousBatch(entries, plan.decisionCount, 'blueprint-plan-decision-sequence-invalid');
    const existing = await readDecisionSequenceRange(ctx, args.planId, entries);
    if (existing.length > 0) {
        if (
            existing.length !== entries.length ||
            existing.some(
                (record, index) =>
                    record.sequence !== entries[index]?.sequence ||
                    canonicalJsonStringify(record.decision) !== canonicalJsonStringify(entries[index].decision)
            )
        ) {
            throw new Error('blueprint-plan-decision-batch-conflict');
        }
        return existing.map(toPlanDecisionRecord);
    }
    await requireDecisionAppendPosition(ctx, args.planId, entries[0]?.sequence ?? 0);
    const batchBytes = entries.reduce(
        (total, entry) =>
            total +
            getDocumentSize({
                decision: entry.decision as Value,
                sequence: entry.sequence,
                planId: args.planId,
                createdAt: now,
            }),
        0
    );
    if (plan.stepLedgerBytes + plan.decisionLedgerBytes + batchBytes > MAX_PLAN_LEDGER_BYTES) {
        throw new Error('blueprint-plan-ledger-too-large');
    }
    const records = [];
    for (const entry of entries) {
        const id = await ctx.db.insert('blueprintPlanDecisions', { ...entry, planId: args.planId, createdAt: now });
        records.push({ id, planId: args.planId, createdAt: now, ...entry });
    }
    await ctx.db.patch('blueprintPlans', plan._id, {
        decisionLedgerBytes: plan.decisionLedgerBytes + batchBytes,
        updatedAt: now,
    });
    return records;
}

export async function listBlueprintPlanStepsByPlanIdPageHandler(ctx: QueryCtx, args: BlueprintPlanStepPageArgs) {
    await requireNeonFluxService(ctx, ['web', 'bot']);
    const plan = await ctx.db.get('blueprintPlans', args.planId);
    if (plan?.guildId !== args.guildId) return { steps: [], nextCursor: null };
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 20), 1), 100);
    const cursor = parseSequenceCursor(args.cursor);
    const records = await ctx.db
        .query('blueprintPlanSteps')
        .withIndex('by_plan_sequence', (q) =>
            cursor === undefined ? q.eq('planId', args.planId) : q.eq('planId', args.planId).gt('sequence', cursor)
        )
        .order('asc')
        .take(limit + 1);
    const page = records.slice(0, limit);
    return {
        steps: page.map(toPlanStepRecord),
        nextCursor: records.length > page.length ? String(page.at(-1)?.sequence ?? '') : null,
    };
}

function assertContiguousBatch(
    entries: ReadonlyArray<{ sequence: number }>,
    expectedCount: number,
    errorType: string
): void {
    const first = entries[0]?.sequence;
    if (
        first === undefined ||
        !Number.isInteger(first) ||
        first < 0 ||
        entries.some((entry, index) => entry.sequence !== first + index) ||
        first + entries.length > expectedCount
    ) {
        throw new Error(errorType);
    }
}

async function readStepSequenceRange(
    ctx: MutationCtx,
    planId: GenericId<'blueprintPlans'>,
    entries: ReadonlyArray<{ sequence: number }>
) {
    const first = entries[0]?.sequence ?? 0;
    const last = entries.at(-1)?.sequence ?? first;
    return ctx.db
        .query('blueprintPlanSteps')
        .withIndex('by_plan_sequence', (q) => q.eq('planId', planId).gte('sequence', first).lte('sequence', last))
        .order('asc')
        .take(entries.length + 1);
}

async function readDecisionSequenceRange(
    ctx: MutationCtx,
    planId: GenericId<'blueprintPlans'>,
    entries: ReadonlyArray<{ sequence: number }>
) {
    const first = entries[0]?.sequence ?? 0;
    const last = entries.at(-1)?.sequence ?? first;
    return ctx.db
        .query('blueprintPlanDecisions')
        .withIndex('by_plan_sequence', (q) => q.eq('planId', planId).gte('sequence', first).lte('sequence', last))
        .order('asc')
        .take(entries.length + 1);
}

async function requireStepAppendPosition(
    ctx: MutationCtx,
    planId: GenericId<'blueprintPlans'>,
    firstSequence: number
): Promise<void> {
    const latest = await ctx.db
        .query('blueprintPlanSteps')
        .withIndex('by_plan_sequence', (q) => q.eq('planId', planId))
        .order('desc')
        .first();
    if (firstSequence !== (latest?.sequence ?? -1) + 1) throw new Error('blueprint-plan-ledger-not-append');
}

async function requireDecisionAppendPosition(
    ctx: MutationCtx,
    planId: GenericId<'blueprintPlans'>,
    firstSequence: number
): Promise<void> {
    const latest = await ctx.db
        .query('blueprintPlanDecisions')
        .withIndex('by_plan_sequence', (q) => q.eq('planId', planId))
        .order('desc')
        .first();
    if (firstSequence !== (latest?.sequence ?? -1) + 1) throw new Error('blueprint-plan-ledger-not-append');
}

async function requireDraftPlan(ctx: MutationCtx, planId: GenericId<'blueprintPlans'>) {
    const plan = await ctx.db.get('blueprintPlans', planId);
    if (!plan) throw new Error('blueprint-plan-not-found');
    if (plan.status !== 'draft') throw new Error('blueprint-plan-ledger-immutable');
    return plan;
}

function toPlanStepRecord(record: { _id: string; createdAt: string; planId: string; sequence: number; step: unknown }) {
    return {
        id: record._id,
        planId: record.planId,
        createdAt: record.createdAt,
        sequence: record.sequence,
        step: record.step,
    };
}

function toPlanDecisionRecord(record: {
    _id: string;
    createdAt: string;
    decision: unknown;
    planId: string;
    sequence: number;
}) {
    return {
        id: record._id,
        planId: record.planId,
        createdAt: record.createdAt,
        sequence: record.sequence,
        decision: record.decision,
    };
}

function parseSequenceCursor(value: string | null | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
