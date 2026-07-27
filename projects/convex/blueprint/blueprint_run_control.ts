import { v } from 'convex/values';
import { mutation } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { blueprintRunLiveAreas } from '../core/dashboard_live_model.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { auditInputValidator, recordBlueprintAuditInMutation } from './blueprint_audit.js';
import { hotRunRecordValidator, toHotRunRecord } from './blueprint_contract_validators.js';
import {
    assertBlueprintRunTerminalRecordInvariant,
    createBlueprintRunControlCancellationRequestDigest,
    finalizeBlueprintRunInMutation,
} from './blueprint_run_terminal_mutation.js';
import { patchBlueprintRunChecked } from './blueprint_run_persistence.js';
import { assertCurrentBlueprintRunProtocol } from './blueprint_run_protocol.js';

const terminalStatuses = [
    'succeeded',
    'partially_applied',
    'failed_before_mutation',
    'needs_reconciliation',
    'outcome_unknown',
    'cancelled',
] as const;

export const requestBlueprintRunControl = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        runId: v.id('blueprintRuns'),
        now: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        request: v.union(v.literal('pause'), v.literal('resume'), v.literal('cancel')),
    },
    returns: v.union(hotRunRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const run = await ctx.db.get('blueprintRuns', args.runId);
        if (!run) return null;
        assertCurrentBlueprintRunProtocol(run);
        const cancellationRequestDigest =
            args.request === 'cancel'
                ? await createBlueprintRunControlCancellationRequestDigest(String(run._id))
                : undefined;
        if (terminalStatuses.includes(run.status as never)) {
            if (args.request !== 'cancel' || run.status !== 'cancelled') {
                throw new Error('blueprint-run-control-invalid');
            }
            if (!cancellationRequestDigest) throw new Error('blueprint-run-control-invalid');
            const evidence = await ctx.db
                .query('blueprintRunVerificationEvidence')
                .withIndex('by_run', (q) => q.eq('runId', run._id))
                .unique();
            await assertBlueprintRunTerminalRecordInvariant({
                evidence,
                expectedTerminalRequestDigest: cancellationRequestDigest,
                run,
                status: 'cancelled',
            });
            return toHotRunRecord(run);
        }
        let status: 'queued' | 'pause_requested' | 'paused' | 'cancelled';
        let controlRequest: 'pause' | 'cancel' | undefined;
        if (args.request === 'resume') {
            if (run.status !== 'paused') throw new Error('blueprint-run-control-invalid');
            status = 'queued';
        } else if (['running', 'verifying', 'pause_requested'].includes(run.status)) {
            status = 'pause_requested';
            controlRequest = args.request;
        } else if (args.request === 'cancel' && ['queued', 'waiting_rate_limit', 'paused'].includes(run.status)) {
            status = 'cancelled';
        } else if (args.request === 'pause' && ['queued', 'waiting_rate_limit'].includes(run.status)) {
            status = 'paused';
        } else {
            throw new Error('blueprint-run-control-invalid');
        }
        if (args.request !== 'resume') {
            await recordBlueprintAuditInMutation(ctx, run.guildId, args.audit, args.now, String(run._id));
        }
        if (status === 'cancelled') {
            if (!cancellationRequestDigest) throw new Error('blueprint-run-control-invalid');
            const patch = await finalizeBlueprintRunInMutation(ctx, {
                run,
                now: args.now,
                status,
                terminalRequestDigest: cancellationRequestDigest,
            });
            return toHotRunRecord({ ...run, ...patch });
        }
        const patch = {
            ...(controlRequest ? { controlRequest } : { controlRequest: undefined }),
            status,
            updatedAt: args.now,
        };
        await patchBlueprintRunChecked(ctx, run, patch);
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: blueprintRunLiveAreas,
            guildId: run.guildId,
            now: args.now,
        });
        if (status === 'paused')
            await recordBlueprintAuditInMutation(
                ctx,
                run.guildId,
                { action: 'blueprint.run_paused' },
                args.now,
                String(run._id)
            );
        if (args.request === 'resume')
            await recordBlueprintAuditInMutation(
                ctx,
                run.guildId,
                args.audit ?? { action: 'blueprint.run_resumed' },
                args.now,
                String(run._id)
            );
        return toHotRunRecord({ ...run, ...patch });
    },
});
