import { v, type Infer } from 'convex/values';

import type { MutationCtx } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { auditInputValidator, recordBlueprintAuditInMutation } from './blueprint_audit.js';
import { toPlanMetadataRecord } from './blueprint_hot_records.js';
import { loadAndValidateBlueprintPlanAuthority } from './blueprint_plan_integrity.js';
import { assertDocumentSize, MAX_PLAN_METADATA_BYTES, requireTimestamp } from './blueprint_plan_persistence_values.js';

export const blueprintPlanFinalizationArgs = {
    audit: v.optional(auditInputValidator),
    now: v.string(),
    planId: v.id('blueprintPlans'),
};

type BlueprintPlanFinalizationArgs = Infer<ReturnType<typeof v.object<typeof blueprintPlanFinalizationArgs>>>;

export async function finalizeBlueprintPlanHandler(ctx: MutationCtx, args: BlueprintPlanFinalizationArgs) {
    await requireNeonFluxService(ctx, ['web']);
    const now = requireTimestamp(args.now, 'blueprint-plan-finalized-at-invalid');
    const plan = await ctx.db.get('blueprintPlans', args.planId);
    if (!plan) throw new Error('blueprint-plan-not-found');
    if (plan.status !== 'draft' && plan.status !== 'review_ready') {
        throw new Error('blueprint-plan-finalization-state-invalid');
    }
    await loadAndValidateBlueprintPlanAuthority(ctx, plan);
    if (plan.status === 'review_ready') return toPlanMetadataRecord(plan);

    const patch = { sealedAt: now, status: 'review_ready' as const, updatedAt: now };
    assertDocumentSize({ ...plan, ...patch }, MAX_PLAN_METADATA_BYTES, 'blueprint-plan-metadata-too-large');
    await ctx.db.patch('blueprintPlans', plan._id, patch);
    await recordBlueprintAuditInMutation(
        ctx,
        plan.guildId,
        args.audit ?? { action: 'blueprint.plan_created' },
        now,
        String(plan._id)
    );
    return toPlanMetadataRecord({ ...plan, ...patch });
}
