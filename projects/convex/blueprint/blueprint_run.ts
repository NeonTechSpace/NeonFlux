import { getDocumentSize, v, type GenericId } from 'convex/values';
import {
    BLUEPRINT_MUTATION_FENCE_VERSION,
    compareBlueprintMutationFenceManifests,
    createBlueprintMutationFenceManifest,
    parseBlueprintMutationFenceManifest,
} from '@neonflux/blueprint/mutation-fence';
import { normalizeBlueprintSnapshot, toPortableBlueprintRestoreSnapshot } from '@neonflux/blueprint/snapshot';
import {
    createBlueprintPreflightDigest,
    createBlueprintRestorePointSnapshotDigest,
    createBlueprintRunVerificationEvidenceDigest,
    validateBlueprintPreflightEvidenceIntegrity,
    validateBlueprintRunVerificationEvidenceIntegrity,
} from '@neonflux/blueprint/integrity';
import {
    normalizeBlueprintRunVerificationEvidence,
    type BlueprintVerificationResult,
} from '@neonflux/blueprint/persisted-authority';

import { mutation, type MutationCtx } from '../_generated/server.js';
import type { Doc } from '../_generated/dataModel.js';
import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { blueprintRunLiveAreas } from '../core/dashboard_live_model.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { auditInputValidator, recordBlueprintAuditInMutation } from './blueprint.js';
import {
    assertBlueprintRunTerminalRecordInvariant,
    buildBlueprintRunPausedPatch,
    createBlueprintRunControlCancellationRequestDigest,
    createBlueprintRunTerminalRequestDigestForRecord,
    createBlueprintRunTerminalSourceDigest,
    finalizeBlueprintRunInMutation,
    resolveBlueprintRunTerminalOutcome,
    resolveBlueprintRunTerminalRetryRequestDigest,
} from './blueprint_run_terminal_mutation.js';
import { patchBlueprintRunChecked } from './blueprint_run_persistence.js';
import { assertBlueprintRunRestoreObservationManifest } from './blueprint_run_restore.js';
import { tryLoadAndValidateBlueprintPlanAuthority } from './blueprint_plan_persistence.js';
import {
    assertCurrentBlueprintRunProtocol,
    findCurrentQueuedOrWaitingBlueprintRun,
    findRunnableBlueprintRunProtocolMismatch,
    findCurrentBlueprintRunReclaimCandidate,
} from './blueprint_run_protocol.js';
import {
    buildBackupSortCursor,
    buildStructureBackupDocument,
    classifyBlueprintRunReclaim,
    isBlueprintRunMutationAuthorizedForLease,
    resolveExpiredBlueprintRunControl,
    resolveBlueprintRunAuthorizationDecision,
    selectBlueprintRunClaimAttempt,
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
            run: { ...run, ...patch, id: run._id },
            cursor: { ...cursor, id: cursor._id, idMap: cursorIdMap },
            plan: { ...plan, id: plan._id },
            authority: { ...validatedAuthority.authorityDocument, id: validatedAuthority.authorityDocument._id },
            executionAuthority: {
                ...validatedAuthority.executionAuthorityDocument,
                id: validatedAuthority.executionAuthorityDocument._id,
            },
            steps: validatedAuthority.steps.map((step) => ({ ...step, id: step._id })),
            decisions: validatedAuthority.decisions.map((decision) => ({ ...decision, id: decision._id })),
            attempts: latestAttempt ? [latestAttempt] : [],
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

export const authorizeBlueprintRunMutation = mutation({
    args: {
        fingerprintVersion: v.literal(BLUEPRINT_MUTATION_FENCE_VERSION),
        runId: v.id('blueprintRuns'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        manifestJson: v.string(),
        now: v.string(),
        observedAt: v.string(),
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
        if (!run.restorePointBackupId || !run.restorePointSnapshotDigest) {
            throw new Error('blueprint-run-restore-point-required');
        }
        const restoreObservation = await validateBlueprintRunRestorePoint(ctx, run);
        if (
            isBlueprintRunMutationAuthorizedForLease({
                completedMutationSteps: run.completedMutationSteps,
                expiresAt: run.preflightExpiresAt,
                leaseId: args.leaseId,
                ...(run.mutationAuthorizedAt ? { mutationAuthorizedAt: run.mutationAuthorizedAt } : {}),
                ...(run.mutationAuthorizationLeaseId
                    ? { mutationAuthorizationLeaseId: run.mutationAuthorizationLeaseId }
                    : {}),
                nextStepSequence: run.nextStepSequence,
                now: args.now,
            })
        ) {
            return { kind: 'not_required' as const, run: { ...run, id: run._id } };
        }
        const snapshotValue = parseJsonRecord(args.structureJson, 'blueprint-run-authorization-snapshot-invalid');
        const normalizedSnapshot = normalizeBlueprintSnapshot(snapshotValue);
        if (normalizedSnapshot.type === 'invalid') throw new Error('blueprint-run-authorization-snapshot-invalid');
        const suppliedManifest = parseBlueprintMutationFenceManifest(
            parseJsonRecord(args.manifestJson, 'blueprint-run-authorization-manifest-invalid')
        );
        const actualManifest = await createBlueprintMutationFenceManifest(normalizedSnapshot.snapshot);
        if (
            suppliedManifest.structureDigest !== actualManifest.structureDigest ||
            suppliedManifest.capabilityDigest !== actualManifest.capabilityDigest ||
            suppliedManifest.guildId !== run.guildId
        ) {
            throw new Error('blueprint-run-authorization-manifest-invalid');
        }
        const restoreManifest = parseBlueprintMutationFenceManifest(
            parseJsonRecord(restoreObservation.manifestJson, 'blueprint-run-restore-observation-invalid')
        );
        const preflight = await ctx.db.get('blueprintPlanPreflights', run.preflightId);
        if (
            preflight?.planId !== run.planId ||
            preflight.guildId !== run.guildId ||
            preflight.preflightDigest !== run.preflightDigest ||
            preflight.expiresAt !== run.preflightExpiresAt
        ) {
            throw new Error('blueprint-run-preflight-missing');
        }
        const preflightEvidence = await ctx.db
            .query('blueprintPlanPreflightEvidence')
            .withIndex('by_preflight', (q) => q.eq('preflightId', preflight._id))
            .unique();
        if (!preflightEvidence) throw new Error('blueprint-run-preflight-missing');
        const evidenceIntegrity = await validateBlueprintPreflightEvidenceIntegrity(
            stripConvexMetadata(preflightEvidence)
        );
        if (
            evidenceIntegrity.type === 'invalid' ||
            evidenceIntegrity.value.preflightId !== String(preflight._id) ||
            evidenceIntegrity.value.planId !== String(run.planId) ||
            evidenceIntegrity.value.evidenceDigest !== preflight.evidenceDigest
        ) {
            throw new Error('blueprint-run-preflight-evidence-invalid');
        }
        const expectedPreflightDigest = await createBlueprintPreflightDigest({
            planId: String(run.planId),
            planDigest: preflight.planDigest,
            status: preflight.status,
            checkedAt: preflight.checkedAt,
            observedAt: preflight.observedAt,
            expiresAt: preflight.expiresAt,
            fingerprintVersion: preflight.fingerprintVersion,
            structureFingerprint: preflight.structureFingerprint,
            capabilityFingerprint: preflight.capabilityFingerprint,
            evidenceDigest: preflight.evidenceDigest,
        });
        if (expectedPreflightDigest !== preflight.preflightDigest) {
            throw new Error('blueprint-run-preflight-digest-invalid');
        }
        const expectedManifest = parseBlueprintMutationFenceManifest(preflightEvidence.mutationFenceManifest);
        const restoreComparison = compareBlueprintMutationFenceManifests(restoreManifest, actualManifest);
        const expectedComparison = compareBlueprintMutationFenceManifests(expectedManifest, actualManifest);
        const rejectionReason = resolveBlueprintRunAuthorizationDecision({
            capabilityChanged: expectedComparison.capabilityChanged,
            fingerprintVersionsCurrent: areBlueprintFingerprintVersionsCurrent(
                run.fingerprintVersion,
                preflight.fingerprintVersion,
                args.fingerprintVersion
            ),
            now: args.now,
            preflightExpiresAt: run.preflightExpiresAt,
            restoreObservationEqual: restoreComparison.equal,
            structureChanged: expectedComparison.structureChanged,
        });
        const existingAuthorizationObservation = await ctx.db
            .query('blueprintRunObservations')
            .withIndex('by_run_phase', (q) => q.eq('runId', run._id).eq('phase', 'authorization'))
            .unique();
        const authorizationObservation = {
            capabilityFingerprint: actualManifest.capabilityDigest,
            fingerprintVersion: args.fingerprintVersion,
            guildId: run.guildId,
            manifestJson: JSON.stringify(actualManifest),
            observedAt: args.observedAt,
            phase: 'authorization' as const,
            runId: run._id,
            source: 'token-client' as const,
            structureFingerprint: actualManifest.structureDigest,
        };
        if (existingAuthorizationObservation) {
            await ctx.db.patch(
                'blueprintRunObservations',
                existingAuthorizationObservation._id,
                authorizationObservation
            );
        } else {
            await ctx.db.insert('blueprintRunObservations', authorizationObservation);
        }
        if (rejectionReason) {
            const mismatch =
                rejectionReason === 'restore_observation_diverged' ? restoreComparison : expectedComparison;
            const observationPatch = {
                authorizationDecision: rejectionReason,
                authorizationMismatchJson: JSON.stringify(mismatch),
                updatedAt: args.now,
            };
            await patchBlueprintRunChecked(ctx, run, observationPatch);
            const patch = await finalizeBlueprintRunInMutation(ctx, {
                errorType: authorizationErrorType(rejectionReason),
                run,
                now: args.now,
                status: 'failed_before_mutation',
                terminalRequestSourceDigest: await createBlueprintRunTerminalSourceDigest({
                    kind: 'authorization_rejection',
                    identity: { actualManifest, rejectionReason },
                }),
            });
            return {
                kind: 'rejected' as const,
                reason: rejectionReason,
                run: { ...run, ...observationPatch, ...patch, id: run._id },
            };
        }
        const authorizationPatch = {
            authorizationDecision: 'authorized' as const,
            authorizationMismatchJson: undefined,
            mutationAuthorizedAt: args.now,
            mutationAuthorizationLeaseId: args.leaseId,
            updatedAt: args.now,
        };
        await patchBlueprintRunChecked(ctx, run, authorizationPatch);
        return {
            kind: 'authorized' as const,
            run: { ...run, ...authorizationPatch, id: run._id },
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
        await patchBlueprintRunChecked(ctx, run, {
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
        observedAt: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        structureJson: v.string(),
    },
    returns: v.object({ backupId: v.string(), snapshotDigest: v.string() }),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const run = await requireRunLease(ctx, args.runId, args.leaseId, args.leaseOwner, args.now, ['running']);
        const snapshotValue = parseJsonRecord(args.structureJson, 'structure-restore-point-json-invalid');
        const normalizedSnapshot = normalizeBlueprintSnapshot(snapshotValue);
        if (normalizedSnapshot.type === 'invalid' || normalizedSnapshot.snapshot.guildId !== run.guildId) {
            throw new Error('blueprint-run-restore-observation-invalid');
        }
        const manifest = await createBlueprintMutationFenceManifest(normalizedSnapshot.snapshot);
        const portableSnapshot = toPortableBlueprintRestoreSnapshot(normalizedSnapshot.snapshot);
        const snapshotDigest = await createBlueprintRestorePointSnapshotDigest(portableSnapshot);
        if (run.restorePointBackupId) {
            await validateBlueprintRunRestorePoint(ctx, run, {
                expectedManifest: manifest,
                expectedSnapshotDigest: snapshotDigest,
            });
            return { backupId: run.restorePointBackupId, snapshotDigest };
        }
        const built = buildStructureBackupDocument(
            {
                createdAt: args.now,
                guildId: run.guildId,
                sortKey: buildBackupSortCursor({ createdAt: args.now, id: crypto.randomUUID() }),
                source: 'restore_point',
                status: 'succeeded',
                structure: portableSnapshot,
            },
            args.now
        );
        if (!built.ok) throw new Error('structure-restore-point-invalid');
        const backupId = await ctx.db.insert('structureBackups', built.value);
        await ctx.db.insert('blueprintRunObservations', {
            capabilityFingerprint: manifest.capabilityDigest,
            fingerprintVersion: BLUEPRINT_MUTATION_FENCE_VERSION,
            guildId: run.guildId,
            manifestJson: JSON.stringify(manifest),
            observedAt: args.observedAt,
            phase: 'restore',
            restorePointBackupId: backupId,
            restorePointSnapshotDigest: snapshotDigest,
            runId: run._id,
            source: 'token-client',
            structureFingerprint: manifest.structureDigest,
        });
        await patchBlueprintRunChecked(ctx, run, {
            restorePointBackupId: String(backupId),
            restorePointSnapshotDigest: snapshotDigest,
            updatedAt: args.now,
        });
        return { backupId: String(backupId), snapshotDigest };
    },
});

async function validateBlueprintRunRestorePoint(
    ctx: MutationCtx,
    run: Doc<'blueprintRuns'>,
    input: {
        expectedManifest?: ReturnType<typeof parseBlueprintMutationFenceManifest>;
        expectedSnapshotDigest?: string;
    } = {}
): Promise<Doc<'blueprintRunObservations'>> {
    if (!run.restorePointBackupId || !run.restorePointSnapshotDigest) {
        throw new Error('blueprint-run-restore-point-required');
    }
    const backupId = run.restorePointBackupId as GenericId<'structureBackups'>;
    const [backup, observation] = await Promise.all([
        ctx.db.get('structureBackups', backupId),
        ctx.db
            .query('blueprintRunObservations')
            .withIndex('by_run_phase', (q) => q.eq('runId', run._id).eq('phase', 'restore'))
            .unique(),
    ]);
    const backupStructure: unknown = backup?.structure;
    const observationManifestJson = observation?.manifestJson;
    if (
        backup?.guildId !== run.guildId ||
        backup.source !== 'restore_point' ||
        backup.status !== 'succeeded' ||
        !backupStructure ||
        observation?.guildId !== run.guildId ||
        observation.restorePointBackupId !== backupId ||
        observation.restorePointSnapshotDigest !== run.restorePointSnapshotDigest ||
        !observationManifestJson
    ) {
        throw new Error('blueprint-run-restore-point-invalid');
    }
    const normalized = normalizeBlueprintSnapshot(backupStructure);
    if (normalized.type === 'invalid' || normalized.snapshot.guildId !== run.guildId) {
        throw new Error('blueprint-run-restore-point-invalid');
    }
    const digest = await createBlueprintRestorePointSnapshotDigest(normalized.snapshot);
    if (
        digest !== run.restorePointSnapshotDigest ||
        (input.expectedSnapshotDigest !== undefined && digest !== input.expectedSnapshotDigest)
    ) {
        throw new Error('blueprint-run-restore-point-invalid');
    }
    const manifest = parseBlueprintMutationFenceManifest(
        parseJsonRecord(observationManifestJson, 'blueprint-run-restore-observation-invalid')
    );
    assertBlueprintRunRestoreObservationManifest({
        ...(input.expectedManifest ? { expectedManifest: input.expectedManifest } : {}),
        guildId: run.guildId,
        manifest,
        observationCapabilityFingerprint: observation.capabilityFingerprint,
        observationStructureFingerprint: observation.structureFingerprint,
    });
    return observation;
}

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
            return { ...run, id: run._id };
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
            return { ...run, ...patch, id: run._id };
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

function areBlueprintFingerprintVersionsCurrent(...versions: readonly number[]): boolean {
    return versions.every((version) => version === BLUEPRINT_MUTATION_FENCE_VERSION);
}

function authorizationErrorType(
    reason:
        | 'preflight_expired'
        | 'structure_changed'
        | 'capability_changed'
        | 'structure_and_capability_changed'
        | 'restore_observation_diverged'
        | 'fingerprint_version_mismatch'
): string {
    switch (reason) {
        case 'preflight_expired':
            return 'preflight-expired-before-mutation';
        case 'structure_changed':
            return 'live-structure-changed-before-mutation';
        case 'capability_changed':
            return 'bot-capability-changed-before-mutation';
        case 'structure_and_capability_changed':
            return 'live-structure-and-capability-changed-before-mutation';
        case 'restore_observation_diverged':
            return 'restore-observation-diverged-before-mutation';
        case 'fingerprint_version_mismatch':
            return 'fingerprint-version-mismatch-before-mutation';
    }
}

function stripConvexMetadata<T extends { _id: unknown; _creationTime: unknown }>(
    value: T
): Omit<T, '_id' | '_creationTime'> {
    const { _id: ignoredId, _creationTime: ignoredCreationTime, ...document } = value;
    void ignoredId;
    void ignoredCreationTime;
    return document;
}
