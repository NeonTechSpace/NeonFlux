import { v } from 'convex/values';

import { mutation, query } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { planMetadataRecordValidator, toPlanMetadataRecord } from './blueprint_hot_records.js';
import { blueprintPlanDraftArgs, createBlueprintPlanDraftHandler } from './blueprint_plan_draft.js';
import { blueprintPlanFinalizationArgs, finalizeBlueprintPlanHandler } from './blueprint_plan_finalization.js';
import { getBlueprintPlanAuthorityHandler } from './blueprint_plan_integrity.js';
import {
    blueprintPlanDecisionBatchArgs,
    blueprintPlanStepBatchArgs,
    blueprintPlanStepPageArgs,
    listBlueprintPlanStepsByPlanIdPageHandler,
    planDecisionRecordValidator,
    planStepRecordValidator,
    writeBlueprintPlanDecisionBatchHandler,
    writeBlueprintPlanStepBatchHandler,
} from './blueprint_plan_ledger.js';

export {
    assertPlanIntegrityMatches,
    loadAndValidateBlueprintPlanAuthority,
    tryLoadAndValidateBlueprintPlanAuthority,
} from './blueprint_plan_integrity.js';

export const createBlueprintPlanDraft = mutation({
    args: blueprintPlanDraftArgs,
    returns: planMetadataRecordValidator,
    handler: createBlueprintPlanDraftHandler,
});

export const writeBlueprintPlanStepBatch = mutation({
    args: blueprintPlanStepBatchArgs,
    returns: v.array(planStepRecordValidator),
    handler: writeBlueprintPlanStepBatchHandler,
});

export const writeBlueprintPlanDecisionBatch = mutation({
    args: blueprintPlanDecisionBatchArgs,
    returns: v.array(planDecisionRecordValidator),
    handler: writeBlueprintPlanDecisionBatchHandler,
});

export const finalizeBlueprintPlan = mutation({
    args: blueprintPlanFinalizationArgs,
    returns: planMetadataRecordValidator,
    handler: finalizeBlueprintPlanHandler,
});

export const getBlueprintPlanMetadata = query({
    args: { guildId: v.string(), planId: v.id('blueprintPlans') },
    returns: v.union(planMetadataRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        return plan?.guildId === args.guildId ? toPlanMetadataRecord(plan) : null;
    },
});

export const getBlueprintPlanAuthority = query({
    args: { guildId: v.string(), planId: v.id('blueprintPlans') },
    returns: v.any(),
    handler: getBlueprintPlanAuthorityHandler,
});

export const listBlueprintPlanStepsByPlanIdPage = query({
    args: blueprintPlanStepPageArgs,
    returns: v.any(),
    handler: listBlueprintPlanStepsByPlanIdPageHandler,
});
