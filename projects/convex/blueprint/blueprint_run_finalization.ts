import { getDocumentSize, v, type GenericId } from 'convex/values';
import {
    createBlueprintRunVerificationEvidenceDigest,
    validateBlueprintRunVerificationEvidenceIntegrity,
} from '@neonflux/blueprint/integrity';
import {
    normalizeBlueprintRunVerificationEvidence,
    type BlueprintVerificationResult,
} from '@neonflux/blueprint/persisted-authority';
import { mutation } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { blueprintRunLiveAreas } from '../core/dashboard_live_model.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { recordBlueprintAuditInMutation } from './blueprint_audit.js';
import {
    assertBlueprintRunTerminalRecordInvariant,
    buildBlueprintRunPausedPatch,
    createBlueprintRunControlCancellationRequestDigest,
    createBlueprintRunTerminalRequestDigestForRecord,
    finalizeBlueprintRunInMutation,
    resolveBlueprintRunTerminalOutcome,
    resolveBlueprintRunTerminalRetryRequestDigest,
} from './blueprint_run_terminal_mutation.js';
import { patchBlueprintRunChecked } from './blueprint_run_persistence.js';
import { assertCurrentBlueprintRunProtocol } from './blueprint_run_protocol.js';
import { requireRunLease } from './blueprint_run_lease.js';

const terminalStatuses = [
    'succeeded',
    'partially_applied',
    'failed_before_mutation',
    'needs_reconciliation',
    'outcome_unknown',
    'cancelled',
] as const;

export const finalizeBlueprintRun = mutation({
    args: {
        errorType: v.optional(v.string()),
        runId: v.id('blueprintRuns'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        status: v.union(
            v.literal('succeeded'),
            v.literal('partially_applied'),
            v.literal('failed_before_mutation'),
            v.literal('needs_reconciliation'),
            v.literal('outcome_unknown'),
            v.literal('cancelled')
        ),
        verificationEvidenceDigest: v.optional(v.string()),
        verificationResult: v.optional(v.any()),
        verificationStatus: v.optional(v.union(v.literal('matched'), v.literal('mismatch'), v.literal('read_failed'))),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const existingRun = await ctx.db.get('blueprintRuns', args.runId);
        if (!existingRun) throw new Error('blueprint-run-not-found');
        assertCurrentBlueprintRunProtocol(existingRun);
        const preservesVerificationEvidence = args.status === 'succeeded' || args.status === 'needs_reconciliation';
        const hasAnyVerificationEvidence =
            args.verificationResult !== undefined ||
            args.verificationStatus !== undefined ||
            args.verificationEvidenceDigest !== undefined;
        if (!preservesVerificationEvidence && hasAnyVerificationEvidence) {
            throw new Error('blueprint-run-verification-invalid');
        }
        const terminalRequestDigest = await createBlueprintRunTerminalRequestDigestForRecord({
            runId: String(existingRun._id),
            requestedStatus: args.status,
            ...(args.errorType ? { errorType: args.errorType } : {}),
            ...(args.verificationEvidenceDigest ? { verificationEvidenceDigest: args.verificationEvidenceDigest } : {}),
            ...(args.verificationResult !== undefined ? { verificationResult: args.verificationResult } : {}),
            ...(args.verificationStatus ? { verificationStatus: args.verificationStatus } : {}),
        });
        if (terminalStatuses.includes(existingRun.status as never)) {
            const retryRequestDigest = await resolveBlueprintRunTerminalRetryRequestDigest({
                requestedTerminalRequestDigest: terminalRequestDigest,
                runId: String(existingRun._id),
                status: existingRun.status as (typeof terminalStatuses)[number],
                storedTerminalRequestDigest: existingRun.terminalRequestDigest,
            });
            const existingEvidence = await ctx.db
                .query('blueprintRunVerificationEvidence')
                .withIndex('by_run', (q) => q.eq('runId', existingRun._id))
                .unique();
            await assertBlueprintRunTerminalRecordInvariant({
                evidence: existingEvidence,
                expectedTerminalRequestDigest: retryRequestDigest,
                run: existingRun,
                status: existingRun.status as (typeof terminalStatuses)[number],
            });
            return { ...existingRun, id: existingRun._id };
        }
        const verificationResolution = preservesVerificationEvidence
            ? await resolveBlueprintRunVerificationEvidence(existingRun, args)
            : undefined;
        const requestedStatus =
            verificationResolution?.forcedReconciliation ||
            (verificationResolution && verificationResolution.evidence.verificationStatus !== 'matched')
                ? ('needs_reconciliation' as const)
                : args.status;
        const run = await requireRunLease(ctx, args.runId, args.leaseId, args.leaseOwner, args.now, [
            'running',
            'pause_requested',
            'verifying',
        ]);
        const outcome = resolveBlueprintRunTerminalOutcome({
            ...(run.controlRequest ? { controlRequest: run.controlRequest } : {}),
            ...(args.errorType ? { requestedErrorType: args.errorType } : {}),
            ...(verificationResolution?.forcedReconciliation
                ? { forcedErrorType: verificationResolution.errorType }
                : {}),
            runStatus: run.status,
            requestedStatus,
        });
        if (outcome.status === 'paused') {
            const patch = buildBlueprintRunPausedPatch(args.now);
            await patchBlueprintRunChecked(ctx, run, patch);
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
            return { ...run, ...patch, id: run._id };
        }
        const verificationEvidence = outcome.preservesVerificationEvidence
            ? verificationResolution?.evidence
            : undefined;
        const resolvedTerminalRequestDigest =
            outcome.status === 'cancelled' && run.controlRequest === 'cancel'
                ? await createBlueprintRunControlCancellationRequestDigest(String(run._id))
                : terminalRequestDigest;
        const existingEvidence = await ctx.db
            .query('blueprintRunVerificationEvidence')
            .withIndex('by_run', (q) => q.eq('runId', run._id))
            .unique();
        if (existingEvidence) throw new Error('blueprint-run-verification-evidence-conflict');
        if (outcome.preservesVerificationEvidence) {
            if (!verificationEvidence) throw new Error('blueprint-run-verification-invalid');
            await ctx.db.insert('blueprintRunVerificationEvidence', verificationEvidence);
        }
        const patch = await finalizeBlueprintRunInMutation(ctx, {
            run,
            now: args.now,
            status: outcome.status,
            terminalRequestDigest: resolvedTerminalRequestDigest,
            ...(outcome.errorType ? { errorType: outcome.errorType } : {}),
            ...(verificationEvidence
                ? {
                      verificationEvidenceDigest: verificationEvidence.verificationEvidenceDigest,
                      verificationEvidenceVersion: 1 as const,
                      verificationStatus: verificationEvidence.verificationStatus,
                  }
                : {}),
        });
        return { ...run, ...patch, id: run._id };
    },
});

async function resolveBlueprintRunVerificationEvidence(
    run: { _id: GenericId<'blueprintRuns'>; planId: GenericId<'blueprintPlans'> },
    input: {
        now: string;
        verificationEvidenceDigest?: string;
        verificationResult?: unknown;
        verificationStatus?: 'matched' | 'mismatch' | 'read_failed';
    }
) {
    const normalized = normalizeBlueprintRunVerificationEvidence({
        version: 1,
        runId: String(run._id),
        planId: String(run.planId),
        verificationStatus: input.verificationStatus,
        result: input.verificationResult,
        verificationEvidenceDigest: input.verificationEvidenceDigest,
        createdAt: input.now,
    });
    if (normalized.type === 'valid') {
        const expectedDigest = await createBlueprintRunVerificationEvidenceDigest({
            runId: String(run._id),
            verificationStatus: normalized.value.verificationStatus,
            result: normalized.value.result,
        });
        const evidence = {
            version: 1 as const,
            runId: run._id,
            planId: run.planId,
            verificationStatus: normalized.value.verificationStatus,
            result: normalized.value.result,
            verificationEvidenceDigest: expectedDigest,
            createdAt: input.now,
        };
        if (expectedDigest === input.verificationEvidenceDigest) {
            if (getDocumentSize(evidence) <= 700 * 1024) {
                const integrity = await validateBlueprintRunVerificationEvidenceIntegrity(evidence);
                if (integrity.type === 'valid') {
                    return { evidence, forcedReconciliation: false as const };
                }
            } else {
                return createVerificationFailureEvidence(run, input.now, 'verification-evidence-too-large');
            }
        }
    }
    return createVerificationFailureEvidence(run, input.now, 'verification-evidence-invalid');
}

async function createVerificationFailureEvidence(
    run: { _id: GenericId<'blueprintRuns'>; planId: GenericId<'blueprintPlans'> },
    createdAt: string,
    reason: 'verification-evidence-invalid' | 'verification-evidence-too-large'
) {
    const result: BlueprintVerificationResult = { version: 1, status: 'read_failed', reason };
    const verificationEvidenceDigest = await createBlueprintRunVerificationEvidenceDigest({
        runId: String(run._id),
        verificationStatus: 'read_failed',
        result,
    });
    return {
        errorType: reason,
        forcedReconciliation: true as const,
        evidence: {
            version: 1 as const,
            runId: run._id,
            planId: run.planId,
            verificationStatus: 'read_failed' as const,
            result,
            verificationEvidenceDigest,
            createdAt,
        },
    };
}
