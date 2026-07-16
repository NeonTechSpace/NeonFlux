import { v } from 'convex/values';
import { mutation } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { blueprintRunLiveAreas } from '../core/dashboard_live_model.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { recordBlueprintAuditInMutation } from './blueprint_audit.js';
import { patchBlueprintRunChecked } from './blueprint_run_persistence.js';
import { validateBlueprintRunProgressTransition } from './blueprint_run_model.js';
import { requireRunLease } from './blueprint_run_lease.js';

export const checkpointBlueprintRun = mutation({
    args: {
        appliedSteps: v.number(),
        completedMutationSteps: v.number(),
        currentStepDomain: v.optional(v.string()),
        currentStepId: v.optional(v.string()),
        currentStepLabel: v.optional(v.string()),
        errorType: v.optional(v.string()),
        runId: v.id('blueprintRuns'),
        failedSteps: v.number(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        nextStepSequence: v.number(),
        notStartedSteps: v.number(),
        now: v.string(),
        phase: v.union(
            v.literal('queued'),
            v.literal('preparing'),
            v.literal('create'),
            v.literal('update'),
            v.literal('delete'),
            v.literal('channel_order'),
            v.literal('role_order'),
            v.literal('waiting_rate_limit'),
            v.literal('paused'),
            v.literal('verifying'),
            v.literal('complete')
        ),
        retryAt: v.optional(v.string()),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        status: v.union(
            v.literal('running'),
            v.literal('waiting_rate_limit'),
            v.literal('pause_requested'),
            v.literal('paused'),
            v.literal('verifying')
        ),
        skippedSteps: v.number(),
        totalMutationSteps: v.number(),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const run = await requireRunLease(ctx, args.runId, args.leaseId, args.leaseOwner, args.now, [
            'running',
            'pause_requested',
            'verifying',
        ]);
        validateBlueprintRunProgressTransition({
            next: args,
            previous: run,
        });
        if (run.status === 'pause_requested' && args.status !== 'pause_requested' && args.status !== 'paused') {
            throw new Error('blueprint-run-pause-fence');
        }
        if (run.status === 'verifying' && args.status !== 'verifying')
            throw new Error('blueprint-run-verification-fence');
        const patch = {
            appliedSteps: args.appliedSteps,
            completedMutationSteps: args.completedMutationSteps,
            ...(args.currentStepDomain ? { currentStepDomain: args.currentStepDomain } : {}),
            ...(args.currentStepId ? { currentStepId: args.currentStepId } : {}),
            ...(args.currentStepLabel ? { currentStepLabel: args.currentStepLabel } : {}),
            ...(args.errorType ? { errorType: args.errorType } : {}),
            failedSteps: args.failedSteps,
            nextStepSequence: args.nextStepSequence,
            notStartedSteps: args.notStartedSteps,
            phase: args.phase,
            ...(args.retryAt ? { retryAt: args.retryAt } : {}),
            skippedSteps: args.skippedSteps,
            status: args.status,
            totalMutationSteps: args.totalMutationSteps,
        };
        await patchBlueprintRunChecked(ctx, run, { ...patch, updatedAt: args.now });
        if (args.status === 'paused') {
            await markDashboardLiveAreasChangedInMutation(ctx, {
                areas: blueprintRunLiveAreas,
                guildId: run.guildId,
                now: args.now,
            });
            await recordBlueprintAuditInMutation(
                ctx,
                run.guildId,
                { action: 'blueprint.run_paused' },
                args.now,
                String(run._id)
            );
        }
        return { ...run, ...patch, updatedAt: args.now };
    },
});
