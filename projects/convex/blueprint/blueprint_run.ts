import { v, type GenericId } from 'convex/values';

import { mutation, type MutationCtx } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { blueprintRunLiveAreas } from '../core/dashboard_live_model.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { auditInputValidator, recordBlueprintAuditInMutation } from './blueprint.js';
import {
    buildBlueprintRunPausedPatch,
    finalizeBlueprintRunInMutation,
    resolveBlueprintRunFinalizationStatus,
} from './blueprint_run_terminal_mutation.js';
import { assertBlueprintRunPlanLedger } from './blueprint_run_ledger.js';
import {
    assertCurrentBlueprintRunProtocol,
    findCurrentQueuedOrWaitingBlueprintRun,
    findRunnableBlueprintRunProtocolMismatch,
    listCurrentBlueprintRunReclaimCandidates,
} from './blueprint_run_protocol.js';
import {
    buildBackupSortCursor,
    buildStructureBackupDocument,
    classifyBlueprintRunReclaim,
    classifyBlueprintRunPreMutationAuthorization,
    resolveBlueprintRunMutationAuthorization,
    resolveExpiredBlueprintRunControl,
    validateBlueprintRunCheckpointIdMap,
    validateBlueprintRunProgressTransition,
} from './blueprint_model.js';

const terminalStatuses = [
    'succeeded',
    'partially_applied',
    'failed_before_mutation',
    'needs_reconciliation',
    'outcome_unknown',
    'cancelled',
] as const;

export const claimNextBlueprintRun = mutation({
    args: {
        leaseExpiresAt: v.string(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        let run = await findCurrentQueuedOrWaitingBlueprintRun(ctx, args.now);
        if (run?.status === 'queued') {
            const authorization = classifyBlueprintRunPreMutationAuthorization({
                completedMutationSteps: run.completedMutationSteps,
                expectedLiveFingerprint: run.preflightLiveFingerprint,
                expiresAt: run.preflightExpiresAt,
                nextStepSequence: run.nextStepSequence,
                now: args.now,
            });
            if (authorization === 'preflight_expired') {
                await finalizeBlueprintRunInMutation(ctx, {
                    errorType: 'preflight-expired-before-claim',
                    run,
                    now: args.now,
                    status: 'failed_before_mutation',
                });
                return null;
            }
        }
        if (!run) {
            for (const status of ['running', 'pause_requested', 'verifying'] as const) {
                const candidates = await listCurrentBlueprintRunReclaimCandidates(ctx, status);
                for (const candidate of candidates) {
                    assertCurrentBlueprintRunProtocol(candidate);
                    const startedAttempt = await ctx.db
                        .query('blueprintRunStepAttempts')
                        .withIndex('by_run_state', (q) => q.eq('runId', candidate._id).eq('state', 'started'))
                        .first();
                    const reclaim = classifyBlueprintRunReclaim({
                        hasStartedAttempt: Boolean(startedAttempt),
                        ...(candidate.leaseExpiresAt ? { leaseExpiresAt: candidate.leaseExpiresAt } : {}),
                        now: args.now,
                    });
                    if (reclaim === 'active') continue;
                    if (reclaim === 'outcome_unknown') {
                        await finalizeBlueprintRunInMutation(ctx, {
                            run: candidate,
                            errorType: 'expired-lease-with-started-attempt',
                            now: args.now,
                            status: 'outcome_unknown',
                        });
                        continue;
                    }
                    if (candidate.status === 'pause_requested') {
                        const cancelled = resolveExpiredBlueprintRunControl(candidate.controlRequest) === 'cancelled';
                        if (cancelled) {
                            await finalizeBlueprintRunInMutation(ctx, {
                                run: candidate,
                                now: args.now,
                                status: 'cancelled',
                            });
                            continue;
                        }
                        const controlPatch = {
                            controlRequest: undefined,
                            leaseExpiresAt: undefined,
                            leaseId: undefined,
                            leaseOwner: undefined,
                            phase: 'paused' as const,
                            status: 'paused' as const,
                            updatedAt: args.now,
                        };
                        await ctx.db.patch('blueprintRuns', candidate._id, controlPatch);
                        await markDashboardLiveAreasChangedInMutation(ctx, {
                            areas: blueprintRunLiveAreas,
                            guildId: candidate.guildId,
                            now: args.now,
                        });
                        await recordBlueprintAuditInMutation(
                            ctx,
                            candidate.guildId,
                            { action: 'blueprint.run_paused' },
                            args.now,
                            String(candidate._id)
                        );
                        continue;
                    }
                    run = candidate;
                    break;
                }
                if (run) break;
            }
        }
        if (!run) return findRunnableBlueprintRunProtocolMismatch(ctx, args.now);
        assertCurrentBlueprintRunProtocol(run);
        const plan = await ctx.db.get('blueprintPlans', run.planId);
        if (!plan) throw new Error('blueprint-plan-not-found');
        const steps = await ctx.db
            .query('blueprintPlanSteps')
            .withIndex('by_plan_sequence', (q) => q.eq('planId', run.planId))
            .order('asc')
            .collect();
        await assertBlueprintRunPlanLedger(plan, steps);
        if (run.totalSteps !== steps.length || run.totalMutationSteps !== steps.length) {
            throw new Error('blueprint-run-step-count-invalid');
        }
        const patch = {
            errorType: undefined,
            heartbeatAt: args.now,
            leaseExpiresAt: args.leaseExpiresAt,
            leaseId: args.leaseId,
            leaseOwner: args.leaseOwner,
            controlRequest: undefined,
            phase: 'preparing' as const,
            retryAt: undefined,
            startedAt: run.startedAt ?? args.now,
            status: 'running' as const,
            updatedAt: args.now,
        };
        await ctx.db.patch('blueprintRuns', run._id, patch);
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: blueprintRunLiveAreas,
            guildId: run.guildId,
            now: args.now,
        });
        const attempts = await ctx.db
            .query('blueprintRunStepAttempts')
            .withIndex('by_run_state', (q) => q.eq('runId', run._id))
            .collect();
        return {
            kind: 'claimed' as const,
            run: { ...run, ...patch, id: run._id },
            plan,
            steps,
            attempts,
        };
    },
});

export const authorizeBlueprintRunMutation = mutation({
    args: {
        runId: v.id('blueprintRuns'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        liveFingerprint: v.string(),
        now: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        structureJson: v.string(),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const run = await ctx.db.get('blueprintRuns', args.runId);
        if (!run) throw new Error('blueprint-run-not-found');
        assertCurrentBlueprintRunProtocol(run);
        if (
            run.status !== 'running' ||
            run.leaseId !== args.leaseId ||
            run.leaseOwner !== args.leaseOwner ||
            !run.leaseExpiresAt ||
            run.leaseExpiresAt < args.now
        ) {
            throw new Error('blueprint-run-lease-lost');
        }
        if (!run.restorePointBackupId) throw new Error('blueprint-run-restore-point-required');
        const authorization = resolveBlueprintRunMutationAuthorization({
            completedMutationSteps: run.completedMutationSteps,
            expectedLiveFingerprint: run.preflightLiveFingerprint,
            expiresAt: run.preflightExpiresAt,
            leaseId: args.leaseId,
            liveFingerprint: args.liveFingerprint,
            nextStepSequence: run.nextStepSequence,
            now: args.now,
            structure: parseJsonRecord(args.structureJson, 'blueprint-run-authorization-snapshot-invalid'),
        });
        if (authorization.type === 'not_required') {
            return { kind: 'not_required' as const, run: { ...run, id: run._id } };
        }
        const rejectionReason =
            authorization.type === 'preflight_expired' || authorization.type === 'live_fingerprint_stale'
                ? authorization.type
                : undefined;
        if (rejectionReason) {
            const patch = await finalizeBlueprintRunInMutation(ctx, {
                errorType:
                    rejectionReason === 'preflight_expired'
                        ? 'preflight-expired-before-mutation'
                        : 'live-fingerprint-stale-before-mutation',
                run,
                now: args.now,
                restorePointBackupId: run.restorePointBackupId,
                status: 'failed_before_mutation',
            });
            return {
                kind: 'rejected' as const,
                reason: rejectionReason,
                run: { ...run, ...patch, id: run._id },
            };
        }
        if (authorization.type !== 'authorized') {
            throw new Error('blueprint-run-authorization-snapshot-invalid');
        }
        const restorePointId = run.restorePointBackupId as GenericId<'structureBackups'>;
        const restorePoint = await ctx.db.get('structureBackups', restorePointId);
        if (
            restorePoint?.guildId !== run.guildId ||
            restorePoint.source !== 'restore_point' ||
            restorePoint.status !== 'succeeded'
        ) {
            throw new Error('blueprint-run-restore-point-invalid');
        }
        await ctx.db.patch('structureBackups', restorePointId, authorization.restorePointPatch);
        await ctx.db.patch('blueprintRuns', run._id, authorization.runPatch);
        return {
            kind: 'authorized' as const,
            run: { ...run, ...authorization.runPatch, id: run._id },
        };
    },
});

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
        await ctx.db.patch('blueprintRuns', run._id, {
            heartbeatAt: args.now,
            leaseExpiresAt: args.leaseExpiresAt,
            updatedAt: args.now,
        });
        return { ...run, heartbeatAt: args.now, leaseExpiresAt: args.leaseExpiresAt, updatedAt: args.now };
    },
});

export const ensureBlueprintRunRestorePoint = mutation({
    args: {
        runId: v.id('blueprintRuns'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        structureJson: v.string(),
    },
    returns: v.object({ backupId: v.string() }),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const run = await requireRunLease(ctx, args.runId, args.leaseId, args.leaseOwner, args.now, ['running']);
        if (run.restorePointBackupId) return { backupId: run.restorePointBackupId };
        const built = buildStructureBackupDocument(
            {
                createdAt: args.now,
                guildId: run.guildId,
                sortKey: buildBackupSortCursor({ createdAt: args.now, id: crypto.randomUUID() }),
                source: 'restore_point',
                status: 'succeeded',
                structure: parseJsonRecord(args.structureJson, 'structure-restore-point-json-invalid'),
            },
            args.now
        );
        if (!built.ok) throw new Error('structure-restore-point-invalid');
        const backupId = await ctx.db.insert('structureBackups', built.value);
        await ctx.db.patch('blueprintRuns', run._id, {
            restorePointBackupId: String(backupId),
            updatedAt: args.now,
        });
        return { backupId: String(backupId) };
    },
});

export const requestBlueprintRunControl = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        runId: v.id('blueprintRuns'),
        now: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        request: v.union(v.literal('pause'), v.literal('resume'), v.literal('cancel')),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const run = await ctx.db.get('blueprintRuns', args.runId);
        if (!run) return null;
        assertCurrentBlueprintRunProtocol(run);
        if (terminalStatuses.includes(run.status as never)) return { ...run, id: run._id };
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
            const patch = await finalizeBlueprintRunInMutation(ctx, {
                run,
                now: args.now,
                status,
            });
            return { ...run, ...patch, id: run._id };
        }
        const patch = {
            ...(controlRequest ? { controlRequest } : { controlRequest: undefined }),
            status,
            updatedAt: args.now,
        };
        await ctx.db.patch('blueprintRuns', run._id, patch);
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
        return { ...run, ...patch, id: run._id };
    },
});

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
        idMapJson: v.string(),
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
        restorePointBackupId: v.optional(v.string()),
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
        if (
            run.restorePointBackupId &&
            args.restorePointBackupId &&
            run.restorePointBackupId !== args.restorePointBackupId
        ) {
            throw new Error('blueprint-run-restore-point-conflict');
        }
        if (run.status === 'pause_requested' && args.status !== 'pause_requested' && args.status !== 'paused') {
            throw new Error('blueprint-run-pause-fence');
        }
        if (run.status === 'verifying' && args.status !== 'verifying')
            throw new Error('blueprint-run-verification-fence');
        const plan = await ctx.db.get('blueprintPlans', run.planId);
        if (!plan) throw new Error('blueprint-plan-not-found');
        const idMap = validateBlueprintRunCheckpointIdMap({
            next: parseJsonRecord(args.idMapJson, 'blueprint-run-id-map-invalid'),
            plan: plan.plan,
            previous: run.idMap,
        });
        const patch = {
            appliedSteps: args.appliedSteps,
            completedMutationSteps: args.completedMutationSteps,
            ...(args.currentStepDomain ? { currentStepDomain: args.currentStepDomain } : {}),
            ...(args.currentStepId ? { currentStepId: args.currentStepId } : {}),
            ...(args.currentStepLabel ? { currentStepLabel: args.currentStepLabel } : {}),
            ...(args.errorType ? { errorType: args.errorType } : {}),
            failedSteps: args.failedSteps,
            idMap,
            nextStepSequence: args.nextStepSequence,
            notStartedSteps: args.notStartedSteps,
            phase: args.phase,
            ...(args.retryAt ? { retryAt: args.retryAt } : {}),
            ...(args.restorePointBackupId ? { restorePointBackupId: args.restorePointBackupId } : {}),
            skippedSteps: args.skippedSteps,
            status: args.status,
            totalMutationSteps: args.totalMutationSteps,
        };
        await ctx.db.patch('blueprintRuns', run._id, { ...patch, updatedAt: args.now });
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: blueprintRunLiveAreas,
            guildId: run.guildId,
            now: args.now,
        });
        if (args.status === 'paused')
            await recordBlueprintAuditInMutation(
                ctx,
                run.guildId,
                { action: 'blueprint.run_paused' },
                args.now,
                String(run._id)
            );
        return { ...run, ...patch, updatedAt: args.now };
    },
});

export const finalizeBlueprintRun = mutation({
    args: {
        errorType: v.optional(v.string()),
        runId: v.id('blueprintRuns'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        restorePointBackupId: v.optional(v.string()),
        status: v.union(
            v.literal('succeeded'),
            v.literal('partially_applied'),
            v.literal('failed_before_mutation'),
            v.literal('needs_reconciliation'),
            v.literal('outcome_unknown'),
            v.literal('cancelled')
        ),
        verificationResultJson: v.optional(v.string()),
        verificationStatus: v.optional(v.union(v.literal('matched'), v.literal('mismatch'), v.literal('read_failed'))),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const run = await requireRunLease(ctx, args.runId, args.leaseId, args.leaseOwner, args.now, [
            'running',
            'pause_requested',
            'verifying',
        ]);
        const resolvedStatus = resolveBlueprintRunFinalizationStatus({
            ...(run.controlRequest ? { controlRequest: run.controlRequest } : {}),
            runStatus: run.status,
            requestedStatus: args.status,
        });
        if (resolvedStatus === 'paused') {
            const patch = buildBlueprintRunPausedPatch(args.now);
            await ctx.db.patch('blueprintRuns', run._id, patch);
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
        const preservesVerificationResult = resolvedStatus === 'succeeded' || resolvedStatus === 'needs_reconciliation';
        const patch = await finalizeBlueprintRunInMutation(ctx, {
            run,
            now: args.now,
            status: resolvedStatus,
            ...(args.errorType ? { errorType: args.errorType } : {}),
            ...(args.restorePointBackupId ? { restorePointBackupId: args.restorePointBackupId } : {}),
            ...(preservesVerificationResult && args.verificationResultJson
                ? {
                      verificationResult: parseJsonRecord(
                          args.verificationResultJson,
                          'blueprint-run-verification-invalid'
                      ),
                  }
                : {}),
            ...(preservesVerificationResult && args.verificationStatus
                ? { verificationStatus: args.verificationStatus }
                : {}),
        });
        return { ...run, ...patch, id: run._id };
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

function parseJsonRecord(value: string, errorType: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // The stable domain error below is the only parse detail callers need.
    }
    throw new Error(errorType);
}
