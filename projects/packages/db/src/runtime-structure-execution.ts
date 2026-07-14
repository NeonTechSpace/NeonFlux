import { api } from '@neonflux/convex-api';
import type { Id } from '@neonflux/convex-api/data-model';
import { err, ok, type Result } from 'neverthrow';

import type {
    StructureImportActionAttemptRecord,
    StructureImportApprovalRecord,
    StructureImportDecisionPageRecord,
    StructureImportDecisionRecord,
    StructureImportExecutionClaimRecord,
    StructureImportExecutionMutationAuthorizationRecord,
    StructureImportExecutionPhase,
    StructureImportExecutionRecord,
    StructureImportExportRepositoryError,
    StructureImportPreflightRecord,
    StructureImportRunRecord,
} from './contracts-structure.js';
import type { ConvexDatabase } from './convex.js';
import {
    assertConvexRuntimeContract,
    ConvexRuntimeContractError,
    STRUCTURE_EXECUTION_PROTOCOL_VERSION,
} from './runtime-contract.js';
import {
    arrayValue,
    recordValue,
    toAction,
    toApproval,
    toAttempt,
    toDecision,
    toExecution,
    toPreflight,
    toRun,
} from './runtime-structure-execution-records.js';

type StructureDb = ConvexDatabase;
export type StructureAuditInput = {
    action: string;
    actorUserId?: string;
    metadata?: Record<string, unknown>;
    targetId?: string;
};

export async function transitionStructureImportPlanState(
    db: StructureDb,
    input: {
        audit?: StructureAuditInput;
        expectedStatus: 'building' | 'needs_mapping' | 'review_ready' | 'approved' | 'stale';
        now: Date;
        runId: string;
        status: 'building' | 'needs_mapping' | 'review_ready' | 'approved' | 'stale';
    }
): Promise<Result<StructureImportRunRecord, StructureImportExportRepositoryError>> {
    try {
        const record = await db.client.mutation(api.structure.transitionStructureImportPlanState, {
            ...(input.audit ? { audit: input.audit } : {}),
            expectedStatus: input.expectedStatus,
            now: input.now.toISOString(),
            runId: input.runId as Id<'structureImportRuns'>,
            status: input.status,
        });
        return ok(toRun(record));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function authorizeStructureImportExecutionMutation(
    db: StructureDb,
    input: {
        executionId: string;
        leaseId: string;
        leaseOwner: string;
        liveFingerprint: string;
        now: Date;
        structure: Record<string, unknown>;
    }
): Promise<Result<StructureImportExecutionMutationAuthorizationRecord, StructureImportExportRepositoryError>> {
    try {
        const value = recordValue(
            await db.client.mutation(api.structure.authorizeStructureImportExecutionMutation, {
                executionId: input.executionId as Id<'structureImportExecutions'>,
                leaseId: input.leaseId,
                leaseOwner: input.leaseOwner,
                liveFingerprint: input.liveFingerprint,
                now: input.now.toISOString(),
                protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
                structureJson: JSON.stringify(input.structure),
            })
        );
        const kind = value.kind;
        if (kind === 'authorized' || kind === 'not_required') {
            return ok({ kind, execution: toExecution(value.execution) });
        }
        if (kind !== 'rejected') throw new Error('invalid-structure-execution-authorization-kind');
        const reason = value.reason;
        if (reason !== 'preflight_expired' && reason !== 'live_fingerprint_stale') {
            throw new Error('invalid-structure-execution-authorization-reason');
        }
        return ok({ kind, reason, execution: toExecution(value.execution) });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findLatestStructureImportPreflight(db: StructureDb, input: { guildId: string; runId: string }) {
    try {
        const record = await db.client.query(api.structure.findLatestStructureImportPreflight, {
            guildId: input.guildId,
            runId: input.runId as Id<'structureImportRuns'>,
        });
        return record ? ok(toPreflight({ ...record, id: record._id })) : ok(null);
    } catch {
        return err({ type: 'database-error' } as const);
    }
}
export async function findLatestStructureImportApproval(db: StructureDb, input: { guildId: string; runId: string }) {
    try {
        const record = await db.client.query(api.structure.findLatestStructureImportApproval, {
            guildId: input.guildId,
            runId: input.runId as Id<'structureImportRuns'>,
        });
        return record ? ok(toApproval({ ...record, id: record._id })) : ok(null);
    } catch {
        return err({ type: 'database-error' } as const);
    }
}
export async function findLatestStructureImportExecution(db: StructureDb, input: { guildId: string; runId: string }) {
    try {
        const record = await db.client.query(api.structure.findLatestStructureImportExecution, {
            guildId: input.guildId,
            runId: input.runId as Id<'structureImportRuns'>,
        });
        return record ? ok(toExecution({ ...record, id: record._id })) : ok(null);
    } catch {
        return err({ type: 'database-error' } as const);
    }
}

export async function findActiveStructureImportExecution(db: StructureDb, input: { guildId: string }) {
    try {
        const record = await db.client.query(api.structure.findActiveStructureImportExecution, {
            guildId: input.guildId,
        });
        return record ? ok(toExecution({ ...record, id: record._id })) : ok(null);
    } catch {
        return err({ type: 'database-error' } as const);
    }
}

export async function recordStructureImportPreflight(
    db: StructureDb,
    input: Omit<StructureImportPreflightRecord, 'id'> & { audit?: StructureAuditInput }
): Promise<Result<StructureImportPreflightRecord, StructureImportExportRepositoryError>> {
    try {
        const record = await db.client.mutation(api.structure.recordStructureImportPreflight, {
            ...input,
            runId: input.runId as Id<'structureImportRuns'>,
            checkedAt: input.checkedAt.toISOString(),
            expiresAt: input.expiresAt.toISOString(),
        });
        return ok(toPreflight(record));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordStructureImportDecisionsBatch(
    db: StructureDb,
    input: { decisions: Array<Omit<StructureImportDecisionRecord, 'id' | 'createdAt'>>; now: Date; runId: string }
): Promise<Result<StructureImportDecisionRecord[], StructureImportExportRepositoryError>> {
    try {
        const records = await db.client.mutation(api.structure.recordStructureImportDecisionsBatch, {
            decisions: input.decisions.map(({ runId, sourceId, targetId, logicalId, name, ...decision }) => {
                void runId;
                return {
                    ...decision,
                    ...(sourceId ? { sourceId } : {}),
                    ...(targetId ? { targetId } : {}),
                    ...(logicalId ? { logicalId } : {}),
                    ...(name ? { name } : {}),
                };
            }),
            now: input.now.toISOString(),
            runId: input.runId as Id<'structureImportRuns'>,
        });
        return ok(records.map(toDecision));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStructureImportDecisionsPage(
    db: StructureDb,
    input: { cursor?: number; guildId: string; limit: number; runId: string }
): Promise<Result<StructureImportDecisionPageRecord, StructureImportExportRepositoryError>> {
    try {
        const page = await db.client.query(api.structure.listStructureImportDecisionsPage, {
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
            guildId: input.guildId,
            limit: input.limit,
            runId: input.runId as Id<'structureImportRuns'>,
        });
        return ok({ decisions: page.decisions.map(toDecision), nextCursor: page.nextCursor ?? null });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function approveStructureImportPlan(
    db: StructureDb,
    input: Omit<StructureImportApprovalRecord, 'id'> & { audit?: StructureAuditInput }
): Promise<Result<StructureImportApprovalRecord, StructureImportExportRepositoryError>> {
    try {
        const record = await db.client.mutation(api.structure.approveStructureImportPlan, {
            ...(input.audit ? { audit: input.audit } : {}),
            approvedAt: input.approvedAt.toISOString(),
            ...(input.approvedByUserId ? { approvedByUserId: input.approvedByUserId } : {}),
            ...(input.deleteSetDigest ? { deleteSetDigest: input.deleteSetDigest } : {}),
            ...(input.destructiveActionCount !== null ? { destructiveActionCount: input.destructiveActionCount } : {}),
            ...(input.destructiveApprovedAt
                ? { destructiveApprovedAt: input.destructiveApprovedAt.toISOString() }
                : {}),
            ...(input.destructivePreflightDigest
                ? { destructivePreflightDigest: input.destructivePreflightDigest }
                : {}),
            planDigest: input.planDigest,
            runId: input.runId as Id<'structureImportRuns'>,
        });
        return ok(toApproval(record));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function enqueueStructureImportExecution(
    db: StructureDb,
    input: { audit?: StructureAuditInput; now: Date; preflightDigest: string; runId: string }
): Promise<Result<StructureImportExecutionRecord, StructureImportExportRepositoryError>> {
    try {
        return ok(
            toExecution(
                await db.client.mutation(api.structure.enqueueStructureImportExecution, {
                    ...(input.audit ? { audit: input.audit } : {}),
                    now: input.now.toISOString(),
                    preflightDigest: input.preflightDigest,
                    protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
                    runId: input.runId as Id<'structureImportRuns'>,
                })
            )
        );
    } catch (error) {
        return err(mapStructureExecutionEnqueueError(error));
    }
}

export async function claimNextStructureImportExecution(
    db: StructureDb,
    input: { leaseExpiresAt: Date; leaseId: string; leaseOwner: string; now: Date }
): Promise<Result<StructureImportExecutionClaimRecord | null, StructureImportExportRepositoryError>> {
    try {
        const claimValue: unknown = await db.client.mutation(api.structure.claimNextStructureImportExecution, {
            leaseExpiresAt: input.leaseExpiresAt.toISOString(),
            leaseId: input.leaseId,
            leaseOwner: input.leaseOwner,
            now: input.now.toISOString(),
            protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
        });
        if (claimValue === null) return ok(null);
        const claim = recordValue(claimValue);
        if (claim.kind === 'protocol_mismatch') {
            return ok({
                executionId: requiredString(claim.executionId),
                executionProtocolVersion: requiredPositiveInteger(claim.executionProtocolVersion),
                guildId: requiredString(claim.guildId),
                kind: 'protocol_mismatch',
                mayHaveExternalEffects: requiredBoolean(claim.mayHaveExternalEffects),
                requiredProtocolVersion: requiredPositiveInteger(claim.requiredProtocolVersion),
                status: requiredString(claim.status),
            });
        }
        if (claim.kind !== 'claimed') throw new Error('invalid-structure-execution-claim-kind');
        return ok({
            kind: 'claimed',
            execution: toExecution(claim.execution),
            run: toRun(claim.run),
            actions: arrayValue(claim.actions).map(toAction),
            attempts: arrayValue(claim.attempts).map(toAttempt),
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

function mapStructureExecutionEnqueueError(error: unknown): StructureImportExportRepositoryError {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('structure-execution-review-stale')) return { type: 'structure-execution-review-stale' };
    if (message.includes('structure-guild-execution-active')) return { type: 'structure-guild-execution-active' };
    if (message.includes('structure-execution-empty')) return { type: 'structure-execution-empty' };
    return { type: 'database-error' };
}

export async function renewStructureImportExecutionLease(
    db: StructureDb,
    input: { executionId: string; leaseExpiresAt: Date; leaseId: string; leaseOwner: string; now: Date }
): Promise<Result<StructureImportExecutionRecord | null, StructureImportExportRepositoryError>> {
    try {
        const record = await db.client.mutation(api.structure.renewStructureImportExecutionLease, {
            executionId: input.executionId as Id<'structureImportExecutions'>,
            leaseExpiresAt: input.leaseExpiresAt.toISOString(),
            leaseId: input.leaseId,
            leaseOwner: input.leaseOwner,
            now: input.now.toISOString(),
            protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
        });
        return ok(record ? toExecution(record) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function requestStructureImportExecutionControl(
    db: StructureDb,
    input: { audit?: StructureAuditInput; executionId: string; now: Date; request: 'pause' | 'resume' | 'cancel' }
): Promise<Result<StructureImportExecutionRecord, StructureImportExportRepositoryError>> {
    try {
        const record = await db.client.mutation(api.structure.requestStructureImportExecutionControl, {
            ...(input.audit ? { audit: input.audit } : {}),
            executionId: input.executionId as Id<'structureImportExecutions'>,
            now: input.now.toISOString(),
            protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
            request: input.request,
        });
        return record ? ok(toExecution(record)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function ensureStructureImportRestorePoint(
    db: StructureDb,
    input: { executionId: string; leaseId: string; leaseOwner: string; now: Date; structure: Record<string, unknown> }
): Promise<Result<{ backupId: string }, StructureImportExportRepositoryError>> {
    try {
        return ok(
            await db.client.mutation(api.structure.ensureStructureImportRestorePoint, {
                executionId: input.executionId as Id<'structureImportExecutions'>,
                leaseId: input.leaseId,
                leaseOwner: input.leaseOwner,
                now: input.now.toISOString(),
                protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
                structureJson: JSON.stringify(input.structure),
            })
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function checkpointStructureImportExecution(
    db: StructureDb,
    input: {
        appliedActions: number;
        completedMutationSteps: number;
        currentActionDomain?: string;
        currentActionId?: string;
        currentActionLabel?: string;
        errorType?: string;
        executionId: string;
        failedActions: number;
        idMap: Record<string, string>;
        leaseId: string;
        leaseOwner: string;
        nextActionSequence: number;
        notStartedActions: number;
        now: Date;
        phase: StructureImportExecutionPhase;
        retryAt?: Date;
        restorePointBackupId?: string;
        status: 'running' | 'waiting_rate_limit' | 'pause_requested' | 'paused' | 'verifying';
        skippedActions: number;
        totalMutationSteps: number;
    }
): Promise<Result<StructureImportExecutionRecord, StructureImportExportRepositoryError>> {
    try {
        const { idMap, retryAt, now, executionId, ...fields } = input;
        return ok(
            toExecution(
                await db.client.mutation(api.structure.checkpointStructureImportExecution, {
                    ...fields,
                    idMapJson: JSON.stringify(idMap),
                    executionId: executionId as Id<'structureImportExecutions'>,
                    now: now.toISOString(),
                    protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
                    ...(retryAt ? { retryAt: retryAt.toISOString() } : {}),
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function prepareStructureImportActionAttempt(
    db: StructureDb,
    input: {
        actionId: string;
        attempt: number;
        executionId: string;
        leaseId: string;
        leaseOwner: string;
        now: Date;
        requestKey: string;
    }
): Promise<Result<StructureImportActionAttemptRecord, StructureImportExportRepositoryError>> {
    try {
        return ok(
            toAttempt(
                await db.client.mutation(api.structure.prepareStructureImportActionAttempt, {
                    ...input,
                    actionId: input.actionId as Id<'structureImportActions'>,
                    executionId: input.executionId as Id<'structureImportExecutions'>,
                    now: input.now.toISOString(),
                    protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function startStructureImportActionAttempt(
    db: StructureDb,
    input: {
        attemptId: string;
        leaseId: string;
        leaseOwner: string;
        now: Date;
    }
): Promise<Result<StructureImportActionAttemptRecord, StructureImportExportRepositoryError>> {
    try {
        return ok(
            toAttempt(
                await db.client.mutation(api.structure.startStructureImportActionAttempt, {
                    attemptId: input.attemptId as Id<'structureImportActionAttempts'>,
                    leaseId: input.leaseId,
                    leaseOwner: input.leaseOwner,
                    now: input.now.toISOString(),
                    protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function completeAndCheckpointStructureImportActionAttempt(
    db: StructureDb,
    input: {
        appliedActions: number;
        attemptId: string;
        completedMutationSteps: number;
        createdId?: string;
        currentActionDomain?: string;
        currentActionId?: string;
        currentActionLabel?: string;
        errorType?: string;
        failedActions: number;
        idMap: Record<string, string>;
        leaseId: string;
        leaseOwner: string;
        nextActionSequence: number;
        notStartedActions: number;
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
        skippedActions: number;
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
): Promise<
    Result<
        { attempt: StructureImportActionAttemptRecord; execution: StructureImportExecutionRecord },
        StructureImportExportRepositoryError
    >
> {
    try {
        const { attemptId, idMap, now, retryAt, ...fields } = input;
        const result = await db.client.mutation(api.structure.completeAndCheckpointStructureImportActionAttempt, {
            ...fields,
            attemptId: attemptId as Id<'structureImportActionAttempts'>,
            idMapJson: JSON.stringify(idMap),
            now: now.toISOString(),
            protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
            ...(retryAt ? { retryAt: retryAt.toISOString() } : {}),
        });
        return ok({ attempt: toAttempt(result.attempt), execution: toExecution(result.execution) });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function finalizeStructureImportExecution(
    db: StructureDb,
    input: {
        errorType?: string;
        executionId: string;
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
): Promise<Result<StructureImportExecutionRecord, StructureImportExportRepositoryError>> {
    try {
        const { verificationResult, ...fields } = input;
        return ok(
            toExecution(
                await db.client.mutation(api.structure.finalizeStructureImportExecution, {
                    ...fields,
                    executionId: input.executionId as Id<'structureImportExecutions'>,
                    now: input.now.toISOString(),
                    protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
                    ...(verificationResult ? { verificationResultJson: JSON.stringify(verificationResult) } : {}),
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}
