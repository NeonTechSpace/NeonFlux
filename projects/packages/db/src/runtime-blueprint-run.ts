import { api } from '@neonflux/convex-api';
import type { Id } from '@neonflux/convex-api/data-model';
import { err, ok, type Result } from 'neverthrow';

import type {
    BlueprintRunStepAttemptRecord,
    BlueprintPlanApprovalRecord,
    BlueprintPlanDecisionPageRecord,
    BlueprintPlanDecisionRecord,
    BlueprintRunClaimRecord,
    BlueprintRunMutationAuthorizationRecord,
    BlueprintRunPhase,
    BlueprintRunRecord,
    BlueprintRepositoryError,
    BlueprintPlanPreflightRecord,
    BlueprintPlanRecord,
} from './contracts-blueprint.js';
import type { ConvexDatabase } from './convex.js';
import {
    assertConvexRuntimeContract,
    ConvexRuntimeContractError,
    BLUEPRINT_RUN_PROTOCOL_VERSION,
} from './runtime-contract.js';
import {
    arrayValue,
    recordValue,
    toBlueprintPlanStep,
    toApproval,
    toBlueprintRunStepAttempt,
    toDecision,
    toBlueprintRun,
    toPreflight,
    toBlueprintPlan,
} from './runtime-blueprint-run-records.js';

type BlueprintDb = ConvexDatabase;
export type BlueprintAuditInput = {
    action: string;
    actorUserId?: string;
    metadata?: Record<string, unknown>;
    targetId?: string;
};

export async function transitionBlueprintPlanState(
    db: BlueprintDb,
    input: {
        audit?: BlueprintAuditInput;
        expectedStatus: 'draft' | 'needs_input' | 'review_ready' | 'approved' | 'obsolete';
        now: Date;
        planId: string;
        status: 'draft' | 'needs_input' | 'review_ready' | 'approved' | 'obsolete';
    }
): Promise<Result<BlueprintPlanRecord, BlueprintRepositoryError>> {
    try {
        const record = await db.client.mutation(api.blueprint.transitionBlueprintPlanState, {
            ...(input.audit ? { audit: input.audit } : {}),
            expectedStatus: input.expectedStatus,
            now: input.now.toISOString(),
            planId: input.planId as Id<'blueprintPlans'>,
            status: input.status,
        });
        return ok(toBlueprintPlan(record));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function authorizeBlueprintRunMutation(
    db: BlueprintDb,
    input: {
        runId: string;
        leaseId: string;
        leaseOwner: string;
        liveFingerprint: string;
        now: Date;
        structure: Record<string, unknown>;
    }
): Promise<Result<BlueprintRunMutationAuthorizationRecord, BlueprintRepositoryError>> {
    try {
        const value = recordValue(
            await db.client.mutation(api.blueprint.authorizeBlueprintRunMutation, {
                runId: input.runId as Id<'blueprintRuns'>,
                leaseId: input.leaseId,
                leaseOwner: input.leaseOwner,
                liveFingerprint: input.liveFingerprint,
                now: input.now.toISOString(),
                protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
                structureJson: JSON.stringify(input.structure),
            })
        );
        const kind = value.kind;
        if (kind === 'authorized' || kind === 'not_required') {
            return ok({ kind, run: toBlueprintRun(value.run) });
        }
        if (kind !== 'rejected') throw new Error('invalid-blueprint-run-authorization-kind');
        const reason = value.reason;
        if (reason !== 'preflight_expired' && reason !== 'live_fingerprint_stale') {
            throw new Error('invalid-blueprint-run-authorization-reason');
        }
        return ok({ kind, reason, run: toBlueprintRun(value.run) });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findLatestBlueprintPlanPreflight(db: BlueprintDb, input: { guildId: string; planId: string }) {
    try {
        const record = await db.client.query(api.blueprint.findLatestBlueprintPlanPreflight, {
            guildId: input.guildId,
            planId: input.planId as Id<'blueprintPlans'>,
        });
        return record ? ok(toPreflight({ ...record, id: record._id })) : ok(null);
    } catch {
        return err({ type: 'database-error' } as const);
    }
}
export async function findLatestBlueprintPlanApproval(db: BlueprintDb, input: { guildId: string; planId: string }) {
    try {
        const record = await db.client.query(api.blueprint.findLatestBlueprintPlanApproval, {
            guildId: input.guildId,
            planId: input.planId as Id<'blueprintPlans'>,
        });
        return record ? ok(toApproval({ ...record, id: record._id })) : ok(null);
    } catch {
        return err({ type: 'database-error' } as const);
    }
}
export async function findLatestBlueprintRunForPlan(db: BlueprintDb, input: { guildId: string; planId: string }) {
    try {
        const record = await db.client.query(api.blueprint.findLatestBlueprintRunForPlan, {
            guildId: input.guildId,
            planId: input.planId as Id<'blueprintPlans'>,
        });
        return record ? ok(toBlueprintRun({ ...record, id: record._id })) : ok(null);
    } catch {
        return err({ type: 'database-error' } as const);
    }
}

export async function findActiveBlueprintRun(db: BlueprintDb, input: { guildId: string }) {
    try {
        const record = await db.client.query(api.blueprint.findActiveBlueprintRun, {
            guildId: input.guildId,
        });
        return record ? ok(toBlueprintRun({ ...record, id: record._id })) : ok(null);
    } catch {
        return err({ type: 'database-error' } as const);
    }
}

export async function recordBlueprintPlanPreflight(
    db: BlueprintDb,
    input: Omit<BlueprintPlanPreflightRecord, 'id'> & { audit?: BlueprintAuditInput }
): Promise<Result<BlueprintPlanPreflightRecord, BlueprintRepositoryError>> {
    try {
        const record = await db.client.mutation(api.blueprint.recordBlueprintPlanPreflight, {
            ...input,
            planId: input.planId as Id<'blueprintPlans'>,
            checkedAt: input.checkedAt.toISOString(),
            expiresAt: input.expiresAt.toISOString(),
        });
        return ok(toPreflight(record));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordBlueprintPlanDecisionsBatch(
    db: BlueprintDb,
    input: { decisions: Array<Omit<BlueprintPlanDecisionRecord, 'id' | 'createdAt'>>; now: Date; planId: string }
): Promise<Result<BlueprintPlanDecisionRecord[], BlueprintRepositoryError>> {
    try {
        const records = await db.client.mutation(api.blueprint.recordBlueprintPlanDecisionsBatch, {
            decisions: input.decisions.map(({ planId, sourceId, targetId, logicalId, name, ...decision }) => {
                void planId;
                return {
                    ...decision,
                    ...(sourceId ? { sourceId } : {}),
                    ...(targetId ? { targetId } : {}),
                    ...(logicalId ? { logicalId } : {}),
                    ...(name ? { name } : {}),
                };
            }),
            now: input.now.toISOString(),
            planId: input.planId as Id<'blueprintPlans'>,
        });
        return ok(records.map(toDecision));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listBlueprintPlanDecisionsPage(
    db: BlueprintDb,
    input: { cursor?: number; guildId: string; limit: number; planId: string }
): Promise<Result<BlueprintPlanDecisionPageRecord, BlueprintRepositoryError>> {
    try {
        const page = await db.client.query(api.blueprint.listBlueprintPlanDecisionsPage, {
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
            guildId: input.guildId,
            limit: input.limit,
            planId: input.planId as Id<'blueprintPlans'>,
        });
        return ok({ decisions: page.decisions.map(toDecision), nextCursor: page.nextCursor ?? null });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function approveBlueprintPlan(
    db: BlueprintDb,
    input: Omit<BlueprintPlanApprovalRecord, 'id'> & { audit?: BlueprintAuditInput }
): Promise<Result<BlueprintPlanApprovalRecord, BlueprintRepositoryError>> {
    try {
        const record = await db.client.mutation(api.blueprint.approveBlueprintPlan, {
            ...(input.audit ? { audit: input.audit } : {}),
            approvedAt: input.approvedAt.toISOString(),
            ...(input.approvedByUserId ? { approvedByUserId: input.approvedByUserId } : {}),
            ...(input.deleteSetDigest ? { deleteSetDigest: input.deleteSetDigest } : {}),
            ...(input.destructiveStepCount !== null ? { destructiveStepCount: input.destructiveStepCount } : {}),
            ...(input.destructiveApprovedAt
                ? { destructiveApprovedAt: input.destructiveApprovedAt.toISOString() }
                : {}),
            ...(input.destructivePreflightDigest
                ? { destructivePreflightDigest: input.destructivePreflightDigest }
                : {}),
            planDigest: input.planDigest,
            planId: input.planId as Id<'blueprintPlans'>,
        });
        return ok(toApproval(record));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function enqueueBlueprintRun(
    db: BlueprintDb,
    input: { audit?: BlueprintAuditInput; now: Date; preflightDigest: string; planId: string }
): Promise<Result<BlueprintRunRecord, BlueprintRepositoryError>> {
    try {
        return ok(
            toBlueprintRun(
                await db.client.mutation(api.blueprint.enqueueBlueprintRun, {
                    ...(input.audit ? { audit: input.audit } : {}),
                    now: input.now.toISOString(),
                    preflightDigest: input.preflightDigest,
                    protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
                    planId: input.planId as Id<'blueprintPlans'>,
                })
            )
        );
    } catch (error) {
        return err(mapBlueprintRunEnqueueError(error));
    }
}

export async function claimNextBlueprintRun(
    db: BlueprintDb,
    input: { leaseExpiresAt: Date; leaseId: string; leaseOwner: string; now: Date }
): Promise<Result<BlueprintRunClaimRecord | null, BlueprintRepositoryError>> {
    try {
        const claimValue: unknown = await db.client.mutation(api.blueprint.claimNextBlueprintRun, {
            leaseExpiresAt: input.leaseExpiresAt.toISOString(),
            leaseId: input.leaseId,
            leaseOwner: input.leaseOwner,
            now: input.now.toISOString(),
            protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        });
        if (claimValue === null) return ok(null);
        const claim = recordValue(claimValue);
        if (claim.kind === 'protocol_mismatch') {
            return ok({
                runId: requiredString(claim.runId),
                runProtocolVersion: requiredPositiveInteger(claim.runProtocolVersion),
                guildId: requiredString(claim.guildId),
                kind: 'protocol_mismatch',
                mayHaveExternalEffects: requiredBoolean(claim.mayHaveExternalEffects),
                requiredProtocolVersion: requiredPositiveInteger(claim.requiredProtocolVersion),
                status: requiredString(claim.status),
            });
        }
        if (claim.kind !== 'claimed') throw new Error('invalid-blueprint-run-claim-kind');
        return ok({
            kind: 'claimed',
            run: toBlueprintRun(claim.run),
            plan: toBlueprintPlan(claim.plan),
            steps: arrayValue(claim.steps).map(toBlueprintPlanStep),
            attempts: arrayValue(claim.attempts).map(toBlueprintRunStepAttempt),
        });
    } catch {
        try {
            await assertConvexRuntimeContract(db);
        } catch (error) {
            if (error instanceof ConvexRuntimeContractError && error.reason === 'version-mismatch') {
                return err({ type: 'backend-incompatible' });
            }
        }
        return err({ type: 'database-error' });
    }
}

function requiredString(value: unknown): string {
    if (typeof value !== 'string') throw new Error('invalid-string');
    return value;
}

function requiredBoolean(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error('invalid-boolean');
    return value;
}

function requiredPositiveInteger(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        throw new Error('invalid-positive-integer');
    }
    return value;
}

function mapBlueprintRunEnqueueError(error: unknown): BlueprintRepositoryError {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('blueprint-run-review-obsolete')) return { type: 'blueprint-run-review-obsolete' };
    if (message.includes('blueprint-guild-run-active')) return { type: 'blueprint-guild-run-active' };
    if (message.includes('blueprint-run-empty')) return { type: 'blueprint-run-empty' };
    return { type: 'database-error' };
}

export async function renewBlueprintRunLease(
    db: BlueprintDb,
    input: { runId: string; leaseExpiresAt: Date; leaseId: string; leaseOwner: string; now: Date }
): Promise<Result<BlueprintRunRecord | null, BlueprintRepositoryError>> {
    try {
        const record = await db.client.mutation(api.blueprint.renewBlueprintRunLease, {
            runId: input.runId as Id<'blueprintRuns'>,
            leaseExpiresAt: input.leaseExpiresAt.toISOString(),
            leaseId: input.leaseId,
            leaseOwner: input.leaseOwner,
            now: input.now.toISOString(),
            protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        });
        return ok(record ? toBlueprintRun(record) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function requestBlueprintRunControl(
    db: BlueprintDb,
    input: { audit?: BlueprintAuditInput; runId: string; now: Date; request: 'pause' | 'resume' | 'cancel' }
): Promise<Result<BlueprintRunRecord, BlueprintRepositoryError>> {
    try {
        const record = await db.client.mutation(api.blueprint.requestBlueprintRunControl, {
            ...(input.audit ? { audit: input.audit } : {}),
            runId: input.runId as Id<'blueprintRuns'>,
            now: input.now.toISOString(),
            protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
            request: input.request,
        });
        return record ? ok(toBlueprintRun(record)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function ensureBlueprintRunRestorePoint(
    db: BlueprintDb,
    input: { runId: string; leaseId: string; leaseOwner: string; now: Date; structure: Record<string, unknown> }
): Promise<Result<{ backupId: string }, BlueprintRepositoryError>> {
    try {
        return ok(
            await db.client.mutation(api.blueprint.ensureBlueprintRunRestorePoint, {
                runId: input.runId as Id<'blueprintRuns'>,
                leaseId: input.leaseId,
                leaseOwner: input.leaseOwner,
                now: input.now.toISOString(),
                protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
                structureJson: JSON.stringify(input.structure),
            })
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function checkpointBlueprintRun(
    db: BlueprintDb,
    input: {
        appliedSteps: number;
        completedMutationSteps: number;
        currentStepDomain?: string;
        currentStepId?: string;
        currentStepLabel?: string;
        errorType?: string;
        runId: string;
        failedSteps: number;
        idMap: Record<string, string>;
        leaseId: string;
        leaseOwner: string;
        nextStepSequence: number;
        notStartedSteps: number;
        now: Date;
        phase: BlueprintRunPhase;
        retryAt?: Date;
        restorePointBackupId?: string;
        status: 'running' | 'waiting_rate_limit' | 'pause_requested' | 'paused' | 'verifying';
        skippedSteps: number;
        totalMutationSteps: number;
    }
): Promise<Result<BlueprintRunRecord, BlueprintRepositoryError>> {
    try {
        const { idMap, retryAt, now, runId, ...fields } = input;
        return ok(
            toBlueprintRun(
                await db.client.mutation(api.blueprint.checkpointBlueprintRun, {
                    ...fields,
                    idMapJson: JSON.stringify(idMap),
                    runId: runId as Id<'blueprintRuns'>,
                    now: now.toISOString(),
                    protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
                    ...(retryAt ? { retryAt: retryAt.toISOString() } : {}),
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function prepareBlueprintRunStepAttempt(
    db: BlueprintDb,
    input: {
        planStepId: string;
        attempt: number;
        runId: string;
        leaseId: string;
        leaseOwner: string;
        now: Date;
        requestKey: string;
    }
): Promise<Result<BlueprintRunStepAttemptRecord, BlueprintRepositoryError>> {
    try {
        return ok(
            toBlueprintRunStepAttempt(
                await db.client.mutation(api.blueprint.prepareBlueprintRunStepAttempt, {
                    ...input,
                    planStepId: input.planStepId as Id<'blueprintPlanSteps'>,
                    runId: input.runId as Id<'blueprintRuns'>,
                    now: input.now.toISOString(),
                    protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function startBlueprintRunStepAttempt(
    db: BlueprintDb,
    input: {
        attemptId: string;
        leaseId: string;
        leaseOwner: string;
        now: Date;
    }
): Promise<Result<BlueprintRunStepAttemptRecord, BlueprintRepositoryError>> {
    try {
        return ok(
            toBlueprintRunStepAttempt(
                await db.client.mutation(api.blueprint.startBlueprintRunStepAttempt, {
                    attemptId: input.attemptId as Id<'blueprintRunStepAttempts'>,
                    leaseId: input.leaseId,
                    leaseOwner: input.leaseOwner,
                    now: input.now.toISOString(),
                    protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function completeAndCheckpointBlueprintRunStepAttempt(
    db: BlueprintDb,
    input: {
        appliedSteps: number;
        attemptId: string;
        completedMutationSteps: number;
        createdId?: string;
        currentStepDomain?: string;
        currentStepId?: string;
        currentStepLabel?: string;
        errorType?: string;
        failedSteps: number;
        idMap: Record<string, string>;
        leaseId: string;
        leaseOwner: string;
        nextStepSequence: number;
        notStartedSteps: number;
        now: Date;
        phase:
            | 'preparing'
            | 'create'
            | 'update'
            | 'delete'
            | 'channel_order'
            | 'role_order'
            | 'waiting_rate_limit'
            | 'complete';
        retryAt?: Date;
        skippedSteps: number;
        state: 'applied' | 'failed' | 'unknown';
        status:
            | 'running'
            | 'pause_requested'
            | 'waiting_rate_limit'
            | 'partially_applied'
            | 'failed_before_mutation'
            | 'outcome_unknown';
        totalMutationSteps: number;
    }
): Promise<Result<{ attempt: BlueprintRunStepAttemptRecord; run: BlueprintRunRecord }, BlueprintRepositoryError>> {
    try {
        const { attemptId, idMap, now, retryAt, ...fields } = input;
        const result = await db.client.mutation(api.blueprint.completeAndCheckpointBlueprintRunStepAttempt, {
            ...fields,
            attemptId: attemptId as Id<'blueprintRunStepAttempts'>,
            idMapJson: JSON.stringify(idMap),
            now: now.toISOString(),
            protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
            ...(retryAt ? { retryAt: retryAt.toISOString() } : {}),
        });
        return ok({ attempt: toBlueprintRunStepAttempt(result.attempt), run: toBlueprintRun(result.run) });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function finalizeBlueprintRun(
    db: BlueprintDb,
    input: {
        errorType?: string;
        runId: string;
        leaseId: string;
        leaseOwner: string;
        now: Date;
        restorePointBackupId?: string;
        status:
            | 'succeeded'
            | 'partially_applied'
            | 'failed_before_mutation'
            | 'needs_reconciliation'
            | 'outcome_unknown'
            | 'cancelled';
        verificationResult?: Record<string, unknown>;
        verificationStatus?: 'matched' | 'mismatch' | 'read_failed';
    }
): Promise<Result<BlueprintRunRecord, BlueprintRepositoryError>> {
    try {
        const { verificationResult, ...fields } = input;
        return ok(
            toBlueprintRun(
                await db.client.mutation(api.blueprint.finalizeBlueprintRun, {
                    ...fields,
                    runId: input.runId as Id<'blueprintRuns'>,
                    now: input.now.toISOString(),
                    protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
                    ...(verificationResult ? { verificationResultJson: JSON.stringify(verificationResult) } : {}),
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}
