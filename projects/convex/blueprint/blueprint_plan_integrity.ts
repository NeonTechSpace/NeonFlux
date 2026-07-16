import { validateBlueprintPlanExecutionAuthorityPersistence } from '@neonflux/blueprint/execution-authority';
import {
    createBlueprintPlanIntegrityDigests,
    validateBlueprintPlanAuthorityIntegrity,
    validateBlueprintPlanExecutionAuthorityIntegrity,
    validateBlueprintPlanMetadataIntegrity,
} from '@neonflux/blueprint/integrity';
import { normalizeBlueprintPlanDecision, normalizeBlueprintPlanStep } from '@neonflux/blueprint/runtime-contracts';
import type { GenericId } from 'convex/values';

import type { Doc } from '../_generated/dataModel.js';
import type { MutationCtx, QueryCtx } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { stripConvexMetadata } from './blueprint_plan_persistence_values.js';

export async function getBlueprintPlanAuthorityHandler(
    ctx: QueryCtx,
    args: { guildId: string; planId: GenericId<'blueprintPlans'> }
) {
    await requireNeonFluxService(ctx, ['web', 'bot']);
    const plan = await ctx.db.get('blueprintPlans', args.planId);
    if (plan?.guildId !== args.guildId) return null;
    const authority = await ctx.db
        .query('blueprintPlanAuthorities')
        .withIndex('by_plan', (q) => q.eq('planId', args.planId))
        .unique();
    if (!authority) return null;
    const integrity = await validateBlueprintPlanAuthorityIntegrity(stripConvexMetadata(authority));
    if (
        integrity.type === 'invalid' ||
        integrity.value.planId !== String(plan._id) ||
        integrity.value.guildId !== plan.guildId ||
        integrity.value.authorityDigest !== plan.authorityDigest
    ) {
        throw new Error('blueprint-plan-authority-integrity-invalid');
    }
    return { ...integrity.value, id: authority._id };
}

export function assertPlanIntegrityMatches(
    plan: {
        authorityDigest: string;
        decisionCount: number;
        decisionLedgerDigest: string;
        deleteSetDigest?: string;
        deleteStepCount: number;
        executionAuthorityDigest: string;
        planDigest: string;
        projectedSnapshotDigest: string;
        requestedSnapshotDigest: string;
        stepCount: number;
        stepLedgerDigest: string;
        summary: Doc<'blueprintPlans'>['summary'];
        decisionSummary: Doc<'blueprintPlans'>['decisionSummary'];
        blockerCount: number;
    },
    integrity: Awaited<ReturnType<typeof createBlueprintPlanIntegrityDigests>>
): void {
    if (validateBlueprintPlanMetadataIntegrity(plan, integrity).type === 'invalid') {
        throw new Error('blueprint-plan-integrity-mismatch');
    }
}

export async function loadAndValidateBlueprintPlanAuthority(ctx: MutationCtx, plan: Doc<'blueprintPlans'>) {
    const [authorities, executionAuthorities, executionAuthorityBuckets, steps, decisions] = await Promise.all([
        ctx.db
            .query('blueprintPlanAuthorities')
            .withIndex('by_plan', (q) => q.eq('planId', plan._id))
            .take(2),
        ctx.db
            .query('blueprintPlanExecutionAuthorities')
            .withIndex('by_plan', (q) => q.eq('planId', plan._id))
            .take(2),
        ctx.db
            .query('blueprintPlanExecutionAuthorityBuckets')
            .withIndex('by_plan', (q) => q.eq('planId', plan._id))
            .collect(),
        ctx.db
            .query('blueprintPlanSteps')
            .withIndex('by_plan_sequence', (q) => q.eq('planId', plan._id))
            .order('asc')
            .collect(),
        ctx.db
            .query('blueprintPlanDecisions')
            .withIndex('by_plan_sequence', (q) => q.eq('planId', plan._id))
            .order('asc')
            .collect(),
    ]);
    if (authorities.length > 1 || executionAuthorities.length > 1) {
        throw new Error('blueprint-plan-authority-duplicate');
    }
    const authority = authorities[0];
    const executionAuthority = executionAuthorities[0];
    if (!authority || !executionAuthority) throw new Error('blueprint-plan-authority-missing');
    const authorityValue = stripConvexMetadata(authority);
    const [authorityResult, persistedExecutionResult] = await Promise.all([
        validateBlueprintPlanAuthorityIntegrity(authorityValue),
        validateBlueprintPlanExecutionAuthorityPersistence({
            manifest: stripConvexMetadata(executionAuthority),
            buckets: executionAuthorityBuckets.map(stripConvexMetadata),
        }),
    ]);
    if (authorityResult.type === 'invalid' || persistedExecutionResult.type === 'invalid') {
        throw new Error('blueprint-plan-authority-integrity-invalid');
    }
    const executionResult = await validateBlueprintPlanExecutionAuthorityIntegrity({
        executionAuthority: persistedExecutionResult.value,
        authority: authorityResult.value,
    });
    if (executionResult.type === 'invalid') throw new Error('blueprint-plan-authority-integrity-invalid');
    const normalizedSteps = steps.map((record) => {
        const normalized = normalizeBlueprintPlanStep(record.step);
        if (normalized.type === 'invalid') throw new Error('blueprint-plan-step-invalid');
        return { ...record, step: normalized.value };
    });
    const normalizedDecisions = decisions.map((record) => {
        const normalized = normalizeBlueprintPlanDecision(record.decision);
        if (normalized.type === 'invalid') throw new Error('blueprint-plan-decision-invalid');
        return { ...record, decision: normalized.value };
    });
    const integrity = await createBlueprintPlanIntegrityDigests({
        guildId: plan.guildId,
        policy: plan.policy,
        summary: plan.summary,
        authority: authorityResult.value,
        executionAuthority: executionResult.value,
        steps: normalizedSteps.map(({ sequence, step }) => ({ sequence, step })),
        decisions: normalizedDecisions.map(({ sequence, decision }) => ({ sequence, decision })),
    });
    assertPlanIntegrityMatches(plan, integrity);
    return {
        authority: authorityResult.value,
        authorityDocument: authority,
        decisions: normalizedDecisions,
        executionAuthority: executionResult.value,
        executionAuthorityDocument: { ...persistedExecutionResult.value, _id: executionAuthority._id },
        steps: normalizedSteps,
    };
}

export async function tryLoadAndValidateBlueprintPlanAuthority(ctx: MutationCtx, plan: Doc<'blueprintPlans'>) {
    try {
        return { type: 'valid' as const, value: await loadAndValidateBlueprintPlanAuthority(ctx, plan) };
    } catch (error) {
        const errorType = error instanceof Error ? error.message : '';
        if (!isDeterministicPlanAuthorityError(errorType)) throw error;
        return { type: 'invalid' as const, errorType };
    }
}

function isDeterministicPlanAuthorityError(errorType: string): boolean {
    return errorType.startsWith('blueprint-plan-') || errorType.startsWith('invalid-blueprint-plan-');
}
