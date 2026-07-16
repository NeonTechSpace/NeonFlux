import { v, type GenericId } from 'convex/values';
import { mutation, type MutationCtx } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { patchBlueprintRunChecked } from './blueprint_run_persistence.js';
import { assertCurrentBlueprintRunProtocol } from './blueprint_run_protocol.js';

export const renewBlueprintRunLease = mutation({
    args: {
        runId: v.id('blueprintRuns'),
        leaseExpiresAt: v.string(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const run = await ctx.db.get('blueprintRuns', args.runId);
        if (run) assertCurrentBlueprintRunProtocol(run);
        if (
            run?.leaseId !== args.leaseId ||
            run.leaseOwner !== args.leaseOwner ||
            !run.leaseExpiresAt ||
            run.leaseExpiresAt < args.now
        ) {
            return null;
        }
        if (!['running', 'pause_requested', 'verifying'].includes(run.status)) return null;
        await patchBlueprintRunChecked(ctx, run, {
            heartbeatAt: args.now,
            leaseExpiresAt: args.leaseExpiresAt,
            updatedAt: args.now,
        });
        return { ...run, heartbeatAt: args.now, leaseExpiresAt: args.leaseExpiresAt, updatedAt: args.now };
    },
});

export async function requireRunLease(
    ctx: MutationCtx,
    runId: GenericId<'blueprintRuns'>,
    leaseId: string,
    leaseOwner: string,
    now: string,
    allowedStatuses: readonly string[]
) {
    const run = await ctx.db.get('blueprintRuns', runId);
    if (run) assertCurrentBlueprintRunProtocol(run);
    if (
        run?.leaseId !== leaseId ||
        run.leaseOwner !== leaseOwner ||
        !run.leaseExpiresAt ||
        run.leaseExpiresAt < now ||
        !allowedStatuses.includes(run.status)
    )
        throw new Error('blueprint-run-lease-lost');
    return run;
}
