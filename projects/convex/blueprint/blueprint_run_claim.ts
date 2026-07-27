import { getDocumentSize, v } from 'convex/values';
import { mutation, type MutationCtx } from '../_generated/server.js';
import type { Doc } from '../_generated/dataModel.js';
import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { blueprintRunLiveAreas } from '../core/dashboard_live_model.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { recordBlueprintAuditInMutation } from './blueprint_audit.js';
import {
    createBlueprintRunControlCancellationRequestDigest,
    createBlueprintRunTerminalSourceDigest,
    finalizeBlueprintRunInMutation,
} from './blueprint_run_terminal_mutation.js';
import { patchBlueprintRunChecked } from './blueprint_run_persistence.js';
import { tryLoadAndValidateBlueprintPlanAuthority } from './blueprint_plan_persistence.js';
import {
    assertCurrentBlueprintRunProtocol,
    findCurrentQueuedOrWaitingBlueprintRun,
    findRunnableBlueprintRunProtocolMismatch,
    findCurrentBlueprintRunReclaimCandidate,
} from './blueprint_run_protocol.js';
import {
    classifyBlueprintRunReclaim,
    resolveExpiredBlueprintRunControl,
    selectBlueprintRunClaimAttempt,
} from './blueprint_run_model.js';
import {
    blueprintRunClaimRecordValidator,
    toBlueprintPlanAuthorityRecord,
    toBlueprintPlanDecisionRecord,
    toBlueprintPlanExecutionAuthorityRecord,
    toBlueprintPlanStepRecord,
    toBlueprintRunCursorRecord,
    toBlueprintRunStepAttemptRecord,
    toHotRunRecord,
} from './blueprint_contract_validators.js';
import { toPlanMetadataRecord } from './blueprint_hot_records.js';

export const claimNextBlueprintRun = mutation({
    args: {
        leaseExpiresAt: v.string(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
    },
    returns: v.union(blueprintRunClaimRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        let run = await findCurrentQueuedOrWaitingBlueprintRun(ctx, args.now);
        if (run?.status === 'queued' && run.preflightExpiresAt <= args.now) {
            await finalizeBlueprintRunInMutation(ctx, {
                errorType: 'preflight-expired-before-claim',
                run,
                now: args.now,
                status: 'failed_before_mutation',
                terminalRequestSourceDigest: await createBlueprintRunTerminalSourceDigest({
                    kind: 'claim_expiry',
                    identity: {
                        preflightExpiresAt: run.preflightExpiresAt,
                        preflightId: String(run.preflightId),
                    },
                }),
            });
            return null;
        }
        if (!run) {
            for (const status of ['running', 'pause_requested', 'verifying'] as const) {
                const candidate = await findCurrentBlueprintRunReclaimCandidate(ctx, status, args.now);
                if (candidate) {
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
                            terminalRequestSourceDigest: await createBlueprintRunTerminalSourceDigest({
                                kind: 'claim_expiry',
                                identity: {
                                    attemptId: startedAttempt ? String(startedAttempt._id) : null,
                                    leaseId: candidate.leaseId ?? null,
                                    requestKey: startedAttempt?.requestKey ?? null,
                                },
                            }),
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
                                terminalRequestDigest: await createBlueprintRunControlCancellationRequestDigest(
                                    String(candidate._id)
                                ),
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
                        await patchBlueprintRunChecked(ctx, candidate, controlPatch);
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
                }
                if (run) break;
            }
        }
        if (!run) return findRunnableBlueprintRunProtocolMismatch(ctx);
        assertCurrentBlueprintRunProtocol(run);
        const plan = await ctx.db.get('blueprintPlans', run.planId);
        const validated = plan
            ? await tryLoadAndValidateBlueprintPlanAuthority(ctx, plan)
            : ({ type: 'invalid', errorType: 'blueprint-plan-not-found' } as const);
        if (
            validated.type === 'invalid' ||
            run.totalSteps !== validated.value.steps.length ||
            run.totalMutationSteps !== validated.value.steps.length ||
            run.executionAuthorityDigest !== validated.value.executionAuthority.executionAuthorityDigest
        ) {
            const errorType =
                validated.type === 'invalid'
                    ? validated.errorType
                    : run.executionAuthorityDigest !== validated.value.executionAuthority.executionAuthorityDigest
                      ? 'blueprint-run-execution-authority-digest-mismatch'
                      : 'blueprint-run-step-count-invalid';
            return quarantineInvalidBlueprintRunClaim(ctx, run, args.now, errorType);
        }
        if (!plan) throw new Error('blueprint-plan-not-found');
        const validatedAuthority = validated.value;
        const cursors = await ctx.db
            .query('blueprintRunCursors')
            .withIndex('by_run', (q) => q.eq('runId', run._id))
            .take(2);
        const cursor = cursors[0];
        if (cursors.length !== 1 || cursor?.planId !== plan._id) {
            return quarantineInvalidBlueprintRunClaim(ctx, run, args.now, 'blueprint-run-cursor-invalid');
        }
        const cursorIdMap = await loadBlueprintRunCursorIdMap(ctx, run, cursor, validatedAuthority.executionAuthority);
        if (!cursorIdMap) {
            return quarantineInvalidBlueprintRunClaim(ctx, run, args.now, 'blueprint-run-cursor-invalid');
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
        await patchBlueprintRunChecked(ctx, run, patch);
        const currentPlanStep = validatedAuthority.steps.find((step) => step.sequence === run.nextStepSequence);
        const currentStepAttempts = currentPlanStep
            ? await ctx.db
                  .query('blueprintRunStepAttempts')
                  .withIndex('by_run_plan_step_attempt', (q) =>
                      q.eq('runId', run._id).eq('planStepId', currentPlanStep._id)
                  )
                  .order('desc')
                  .take(11)
            : [];
        let latestAttempt: (typeof currentStepAttempts)[number] | null;
        try {
            latestAttempt = selectBlueprintRunClaimAttempt(currentStepAttempts);
        } catch {
            return quarantineInvalidBlueprintRunClaim(ctx, run, args.now, 'blueprint-run-pending-attempt-conflict');
        }
        return {
            kind: 'claimed' as const,
            run: toHotRunRecord({ ...run, ...patch }),
            cursor: toBlueprintRunCursorRecord(cursor, cursorIdMap),
            plan: toPlanMetadataRecord(plan),
            authority: toBlueprintPlanAuthorityRecord(validatedAuthority.authorityDocument),
            executionAuthority: toBlueprintPlanExecutionAuthorityRecord(validatedAuthority.executionAuthorityDocument),
            steps: validatedAuthority.steps.map(toBlueprintPlanStepRecord),
            decisions: validatedAuthority.decisions.map(toBlueprintPlanDecisionRecord),
            attempts: latestAttempt ? [toBlueprintRunStepAttemptRecord(latestAttempt)] : [],
        };
    },
});

async function loadBlueprintRunCursorIdMap(
    ctx: MutationCtx,
    run: Doc<'blueprintRuns'>,
    cursor: Doc<'blueprintRunCursors'>,
    executionAuthority: {
        initialIdMap: Record<string, string>;
        knownTargetKinds: Record<string, string>;
        sourceTargetMap: Record<string, string | null>;
    }
): Promise<Record<string, string> | null> {
    if (!Number.isSafeInteger(cursor.mappingCount) || cursor.mappingCount < 0 || cursor.mappingCount > run.totalSteps) {
        return null;
    }
    const mappings = await ctx.db
        .query('blueprintRunIdMappings')
        .withIndex('by_run', (q) => q.eq('runId', run._id))
        .collect();
    if (mappings.length !== cursor.mappingCount) return null;
    const idMap = { ...executionAuthority.initialIdMap };
    const targetIds = new Set(Object.values(idMap));
    for (const mapping of mappings) {
        if (
            mapping.planId !== run.planId ||
            executionAuthority.sourceTargetMap[mapping.sourceId] !== null ||
            Object.hasOwn(idMap, mapping.sourceId) ||
            Object.hasOwn(executionAuthority.knownTargetKinds, mapping.targetId) ||
            targetIds.has(mapping.targetId)
        ) {
            return null;
        }
        idMap[mapping.sourceId] = mapping.targetId;
        targetIds.add(mapping.targetId);
    }
    return getDocumentSize(idMap) <= 256 * 1024 ? idMap : null;
}

async function quarantineInvalidBlueprintRunClaim(
    ctx: MutationCtx,
    run: Doc<'blueprintRuns'>,
    now: string,
    errorType: string
) {
    const mayHaveExternalEffects = run.appliedSteps > 0 || run.completedMutationSteps > 0;
    const status = mayHaveExternalEffects ? ('partially_applied' as const) : ('failed_before_mutation' as const);
    await finalizeBlueprintRunInMutation(ctx, {
        errorType: `authority-invalid:${errorType}`,
        run,
        now,
        status,
        terminalRequestSourceDigest: await createBlueprintRunTerminalSourceDigest({
            kind: 'authority_rejection',
            identity: {
                errorType,
                executionAuthorityDigest: run.executionAuthorityDigest,
                planId: String(run.planId),
            },
        }),
    });
    return {
        kind: 'authority_invalid' as const,
        errorType,
        guildId: run.guildId,
        mayHaveExternalEffects,
        runId: String(run._id),
        status,
    };
}
