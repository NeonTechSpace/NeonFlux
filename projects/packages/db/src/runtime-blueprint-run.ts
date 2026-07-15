import { api } from '@neonflux/convex-api';
import type { Id } from '@neonflux/convex-api/data-model';
import { BLUEPRINT_MUTATION_FENCE_VERSION } from '@neonflux/blueprint/mutation-fence';
import { normalizeBlueprintPlanDecision } from '@neonflux/blueprint/runtime-contracts';
import type { BlueprintVerificationResult } from '@neonflux/blueprint/persisted-authority';
import { err, ok, type Result } from 'neverthrow';

import type {
    BlueprintRunStepAttemptRecord,
    BlueprintRunStepPreparationRecord,
    BlueprintRunStepStartRecord,
    BlueprintPlanApprovalRecord,
    BlueprintPlanAuthorityRecord,
    BlueprintPlanDecisionPageRecord,
    BlueprintPlanDecisionRecord,
    BlueprintPlanMetadataRecord,
    BlueprintPlanPreflightEvidenceRecord,
    BlueprintPlanPreflightMetadataRecord,
    BlueprintPlanPreflightSummaryRecord,
    BlueprintPlanStepRecord,
    BlueprintRunClaimRecord,
    BlueprintRunMutationAuthorizationRecord,
    BlueprintRunPhase,
    BlueprintRunRecord,
    BlueprintRunSummaryRecord,
    BlueprintRunVerificationEvidenceRecord,
    BlueprintRepositoryError,
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
    toPreflightMetadata,
    toPreflightEvidence,
    toBlueprintPlanMetadata,
    toBlueprintPlanAuthority,
    toBlueprintPlanExecutionAuthority,
    toBlueprintRunCursor,
    toBlueprintRunVerificationEvidence,
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
): Promise<Result<BlueprintPlanMetadataRecord, BlueprintRepositoryError>> {
    if (
        input.expectedStatus === 'draft' &&
        (input.status === 'needs_input' || input.status === 'review_ready' || input.status === 'approved')
    ) {
        return err({ type: 'database-error' });
    }
    try {
        const record = await db.client.mutation(api.blueprint.transitionBlueprintPlanState, {
            ...(input.audit ? { audit: input.audit } : {}),
            expectedStatus: input.expectedStatus,
            now: input.now.toISOString(),
            planId: input.planId as Id<'blueprintPlans'>,
            status: input.status,
        });
        return ok(toBlueprintPlanMetadata(record));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function finalizeBlueprintPlan(
    db: BlueprintDb,
    input: { audit?: BlueprintAuditInput; now: Date; planId: string }
): Promise<Result<BlueprintPlanMetadataRecord, BlueprintRepositoryError>> {
    try {
        const record = await db.client.mutation(api.blueprint.finalizeBlueprintPlan, {
            ...(input.audit ? { audit: input.audit } : {}),
            now: input.now.toISOString(),
            planId: input.planId as Id<'blueprintPlans'>,
        });
        return ok(toBlueprintPlanMetadata(record));
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
        manifest: Record<string, unknown>;
        now: Date;
        observedAt: Date;
        structure: Record<string, unknown>;
    }
): Promise<Result<BlueprintRunMutationAuthorizationRecord, BlueprintRepositoryError>> {
    try {
        const value = recordValue(
            await db.client.mutation(api.blueprint.authorizeBlueprintRunMutation, {
                runId: input.runId as Id<'blueprintRuns'>,
                leaseId: input.leaseId,
                leaseOwner: input.leaseOwner,
                fingerprintVersion: BLUEPRINT_MUTATION_FENCE_VERSION,
                manifestJson: JSON.stringify(input.manifest),
                now: input.now.toISOString(),
                observedAt: input.observedAt.toISOString(),
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
        if (
            reason !== 'preflight_expired' &&
            reason !== 'structure_changed' &&
            reason !== 'capability_changed' &&
            reason !== 'structure_and_capability_changed' &&
            reason !== 'restore_observation_diverged' &&
            reason !== 'fingerprint_version_mismatch'
        ) {
            throw new Error('invalid-blueprint-run-authorization-reason');
        }
        return ok({ kind, reason, run: toBlueprintRun(value.run) });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listLatestBlueprintPlanPreflightSummaries(
    db: BlueprintDb,
    input: { guildId: string; planIds: string[] }
): Promise<Result<Record<string, BlueprintPlanPreflightSummaryRecord | null>, BlueprintRepositoryError>> {
    const planIds = normalizePlanIds(input.planIds);
    if (!planIds) return err({ field: 'planIds', type: 'invalid-value' });
    try {
        const value = recordValue(
            await db.client.query(api.blueprint.listLatestBlueprintPlanPreflightSummaries, {
                guildId: input.guildId,
                planIds: planIds as Array<Id<'blueprintPlans'>>,
            })
        );
        return ok(
            Object.fromEntries(
                planIds.map((planId) => {
                    const record = value[planId];
                    return [planId, record === undefined || record === null ? null : toPreflightMetadata(record)];
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function getBlueprintPlanPreflightEvidence(
    db: BlueprintDb,
    input: { guildId: string; preflightId: string }
): Promise<Result<BlueprintPlanPreflightEvidenceRecord, BlueprintRepositoryError>> {
    try {
        const record = await db.client.query(api.blueprint.getBlueprintPlanPreflightEvidence, {
            guildId: input.guildId,
            preflightId: input.preflightId as Id<'blueprintPlanPreflights'>,
        });
        return record ? ok(toPreflightEvidence(record)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
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
export async function listLatestBlueprintRunSummaries(
    db: BlueprintDb,
    input: { guildId: string; planIds: string[] }
): Promise<Result<Record<string, BlueprintRunSummaryRecord | null>, BlueprintRepositoryError>> {
    const planIds = normalizePlanIds(input.planIds);
    if (!planIds) return err({ field: 'planIds', type: 'invalid-value' });
    try {
        const value = recordValue(
            await db.client.query(api.blueprint.listLatestBlueprintRunSummaries, {
                guildId: input.guildId,
                planIds: planIds as Array<Id<'blueprintPlans'>>,
            })
        );
        return ok(
            Object.fromEntries(
                planIds.map((planId) => {
                    const record = value[planId];
                    return [planId, record === undefined || record === null ? null : toBlueprintRun(record)];
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function getBlueprintRunVerificationEvidence(
    db: BlueprintDb,
    input: { guildId: string; runId: string }
): Promise<Result<BlueprintRunVerificationEvidenceRecord, BlueprintRepositoryError>> {
    try {
        const record = await db.client.query(api.blueprint.getBlueprintRunVerificationEvidence, {
            guildId: input.guildId,
            runId: input.runId as Id<'blueprintRuns'>,
        });
        return record ? ok(toBlueprintRunVerificationEvidence(record)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findActiveBlueprintRun(db: BlueprintDb, input: { guildId: string }) {
    try {
        const record = await db.client.query(api.blueprint.findActiveBlueprintRun, {
            guildId: input.guildId,
        });
        return record ? ok(toBlueprintRun(record)) : ok(null);
    } catch {
        return err({ type: 'database-error' } as const);
    }
}

export async function recordBlueprintPlanPreflight(
    db: BlueprintDb,
    input: {
        audit?: BlueprintAuditInput;
        metadata: Omit<BlueprintPlanPreflightMetadataRecord, 'id'>;
        evidence: Omit<BlueprintPlanPreflightEvidenceRecord, 'createdAt' | 'id' | 'planId' | 'preflightId'>;
        sealedPlan: {
            authority: BlueprintPlanAuthorityRecord;
            decisions: Array<Pick<BlueprintPlanDecisionRecord, 'decision' | 'sequence'>>;
            steps: Array<Pick<BlueprintPlanStepRecord, 'sequence' | 'step'>>;
        };
    }
): Promise<Result<BlueprintPlanPreflightMetadataRecord, BlueprintRepositoryError>> {
    try {
        const record = await db.client.mutation(api.blueprint.recordBlueprintPlanPreflight, {
            ...(input.audit ? { audit: input.audit } : {}),
            metadata: {
                ...input.metadata,
                planId: input.metadata.planId as Id<'blueprintPlans'>,
                checkedAt: input.metadata.checkedAt.toISOString(),
                expiresAt: input.metadata.expiresAt.toISOString(),
                observedAt: input.metadata.observedAt.toISOString(),
            },
            evidence: input.evidence,
            sealedPlan: {
                authority: {
                    ...input.sealedPlan.authority,
                    createdAt: input.sealedPlan.authority.createdAt.toISOString(),
                },
                decisions: input.sealedPlan.decisions,
                steps: input.sealedPlan.steps,
            },
        });
        return ok(toPreflightMetadata(record));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function writeBlueprintPlanDecisionBatch(
    db: BlueprintDb,
    input: {
        decisions: Array<Pick<BlueprintPlanDecisionRecord, 'decision' | 'sequence'>>;
        now: Date;
        planId: string;
    }
): Promise<Result<BlueprintPlanDecisionRecord[], BlueprintRepositoryError>> {
    if (input.decisions.length < 1 || input.decisions.length > 100 || !hasContiguousSequences(input.decisions)) {
        return err({ field: 'decisions', type: 'invalid-value' });
    }
    const decisions = [];
    for (const entry of input.decisions) {
        const decision = normalizeBlueprintPlanDecision(entry.decision);
        if (decision.type === 'invalid') return err({ field: 'decision', type: 'invalid-value' });
        decisions.push({ sequence: entry.sequence, decision: decision.value });
    }
    try {
        const records = await db.client.mutation(api.blueprint.writeBlueprintPlanDecisionBatch, {
            decisions,
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
    input: Omit<
        BlueprintPlanApprovalRecord,
        | 'id'
        | 'fingerprintVersion'
        | 'approvedStructureFingerprint'
        | 'approvedCapabilityFingerprint'
        | 'confirmationMethod'
    > & {
        audit?: BlueprintAuditInput;
        confirmationMethod?: 'acknowledgement' | 'target_name';
    }
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
            ...(input.confirmationMethod ? { confirmationMethod: input.confirmationMethod } : {}),
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
        if (claim.kind === 'authority_invalid') {
            return ok({
                kind: 'authority_invalid',
                errorType: requiredString(claim.errorType),
                guildId: requiredString(claim.guildId),
                mayHaveExternalEffects: requiredBoolean(claim.mayHaveExternalEffects),
                runId: requiredString(claim.runId),
                status: requiredLiteral(claim.status, ['failed_before_mutation', 'partially_applied']),
            });
        }
        if (claim.kind !== 'claimed') throw new Error('invalid-blueprint-run-claim-kind');
        return ok({
            kind: 'claimed',
            run: toBlueprintRun(claim.run),
            cursor: toBlueprintRunCursor(claim.cursor),
            plan: toBlueprintPlanMetadata(claim.plan),
            authority: toBlueprintPlanAuthority(claim.authority),
            executionAuthority: toBlueprintPlanExecutionAuthority(claim.executionAuthority),
            steps: arrayValue(claim.steps).map(toBlueprintPlanStep),
            decisions: arrayValue(claim.decisions).map(toDecision),
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

function requiredLiteral<const T extends string>(value: unknown, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error('invalid-literal');
    return value as T;
}

function requiredPositiveInteger(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        throw new Error('invalid-positive-integer');
    }
    return value;
}

function mapBlueprintRunEnqueueError(error: unknown): BlueprintRepositoryError {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('blueprint-run-review-stale')) return { type: 'blueprint-run-review-stale' };
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
    input: {
        runId: string;
        leaseId: string;
        leaseOwner: string;
        now: Date;
        observedAt: Date;
        structure: Record<string, unknown>;
    }
): Promise<Result<{ backupId: string; snapshotDigest: string }, BlueprintRepositoryError>> {
    try {
        return ok(
            await db.client.mutation(api.blueprint.ensureBlueprintRunRestorePoint, {
                runId: input.runId as Id<'blueprintRuns'>,
                leaseId: input.leaseId,
                leaseOwner: input.leaseOwner,
                now: input.now.toISOString(),
                observedAt: input.observedAt.toISOString(),
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
        leaseId: string;
        leaseOwner: string;
        nextStepSequence: number;
        notStartedSteps: number;
        now: Date;
        phase: BlueprintRunPhase;
        retryAt?: Date;
        status: 'running' | 'waiting_rate_limit' | 'pause_requested' | 'paused' | 'verifying';
        skippedSteps: number;
        totalMutationSteps: number;
    }
): Promise<Result<BlueprintRunRecord, BlueprintRepositoryError>> {
    try {
        const { retryAt, now, runId, ...fields } = input;
        return ok(
            toBlueprintRun(
                await db.client.mutation(api.blueprint.checkpointBlueprintRun, {
                    ...fields,
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
        leaseExpiresAt: Date;
        leaseOwner: string;
        now: Date;
        requestKey: string;
    }
): Promise<Result<BlueprintRunStepPreparationRecord, BlueprintRepositoryError>> {
    try {
        const result = await db.client.mutation(api.blueprint.prepareBlueprintRunStepAttempt, {
            ...input,
            leaseExpiresAt: input.leaseExpiresAt.toISOString(),
            planStepId: input.planStepId as Id<'blueprintPlanSteps'>,
            runId: input.runId as Id<'blueprintRuns'>,
            now: input.now.toISOString(),
            protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        });
        return ok({
            kind: requiredLiteral(result.kind, ['prepared', 'control_requested']),
            attempt: toBlueprintRunStepAttempt(result.attempt),
            run: toBlueprintRun(result.run),
        });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function startBlueprintRunStepAttempt(
    db: BlueprintDb,
    input: {
        attemptId: string;
        leaseId: string;
        leaseExpiresAt: Date;
        leaseOwner: string;
        now: Date;
    }
): Promise<Result<BlueprintRunStepStartRecord, BlueprintRepositoryError>> {
    try {
        const result = await db.client.mutation(api.blueprint.startBlueprintRunStepAttempt, {
            attemptId: input.attemptId as Id<'blueprintRunStepAttempts'>,
            leaseId: input.leaseId,
            leaseExpiresAt: input.leaseExpiresAt.toISOString(),
            leaseOwner: input.leaseOwner,
            now: input.now.toISOString(),
            protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        });
        return ok({
            kind: requiredLiteral(result.kind, ['started', 'control_requested']),
            attempt: toBlueprintRunStepAttempt(result.attempt),
            run: toBlueprintRun(result.run),
        });
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
        const { attemptId, now, retryAt, ...fields } = input;
        const result = await db.client.mutation(api.blueprint.completeAndCheckpointBlueprintRunStepAttempt, {
            ...fields,
            attemptId: attemptId as Id<'blueprintRunStepAttempts'>,
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
        status:
            | 'succeeded'
            | 'partially_applied'
            | 'failed_before_mutation'
            | 'needs_reconciliation'
            | 'outcome_unknown'
            | 'cancelled';
        verificationResult?: BlueprintVerificationResult;
        verificationStatus?: 'matched' | 'mismatch' | 'read_failed';
        verificationEvidenceDigest?: string;
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
                    ...(verificationResult ? { verificationResult } : {}),
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizePlanIds(values: readonly string[]): string[] | undefined {
    if (values.length < 1 || values.length > 20) return undefined;
    const normalized = values.map((value) => value.trim());
    if (normalized.some((value) => value.length === 0) || new Set(normalized).size !== normalized.length) {
        return undefined;
    }
    return normalized;
}

function hasContiguousSequences(entries: ReadonlyArray<{ sequence: number }>): boolean {
    const firstSequence = entries[0]?.sequence;
    return (
        firstSequence !== undefined &&
        Number.isSafeInteger(firstSequence) &&
        firstSequence >= 0 &&
        entries.every((entry, index) => entry.sequence === firstSequence + index)
    );
}
