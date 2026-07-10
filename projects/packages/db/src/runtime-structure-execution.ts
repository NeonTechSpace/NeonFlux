import { api } from '@neonflux/convex-api';
import type { Id } from '@neonflux/convex-api/data-model';
import { err, ok, type Result } from 'neverthrow';

import type {
    StructureImportActionAttemptRecord,
    StructureImportApprovalRecord,
    StructureImportDecisionPageRecord,
    StructureImportDecisionRecord,
    StructureImportExecutionClaimRecord,
    StructureImportExecutionPhase,
    StructureImportExecutionRecord,
    StructureImportExportRepositoryError,
    StructureImportPreflightRecord,
    StructureImportRunRecord,
} from './contracts-structure.js';
import type { ConvexDatabase } from './convex.js';
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
                    runId: input.runId as Id<'structureImportRuns'>,
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
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
        });
        if (claimValue === null) return ok(null);
        const claim = recordValue(claimValue);
        if (claim.run === null || claim.run === undefined) return ok(null);
        return ok({
            execution: toExecution(claim.execution),
            run: toRun(claim.run),
            actions: arrayValue(claim.actions).map(toAction),
            attempts: arrayValue(claim.attempts).map(toAttempt),
        });
    } catch {
        return err({ type: 'database-error' });
    }
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
        });
        return ok(record ? toExecution(record) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function requestStructureImportExecutionControl(
    db: StructureDb,
    input: { executionId: string; now: Date; request: 'pause' | 'resume' | 'cancel' }
): Promise<Result<StructureImportExecutionRecord, StructureImportExportRepositoryError>> {
    try {
        const record = await db.client.mutation(api.structure.requestStructureImportExecutionControl, {
            executionId: input.executionId as Id<'structureImportExecutions'>,
            now: input.now.toISOString(),
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
                    ...(retryAt ? { retryAt: retryAt.toISOString() } : {}),
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
                await db.client.mutation(api.structure.startStructureImportActionAttempt, {
                    ...input,
                    actionId: input.actionId as Id<'structureImportActions'>,
                    executionId: input.executionId as Id<'structureImportExecutions'>,
                    now: input.now.toISOString(),
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function completeStructureImportActionAttempt(
    db: StructureDb,
    input: {
        attemptId: string;
        createdId?: string;
        errorType?: string;
        leaseId: string;
        leaseOwner: string;
        now: Date;
        retryAt?: Date;
        state: 'applied' | 'failed' | 'unknown';
    }
): Promise<Result<StructureImportActionAttemptRecord, StructureImportExportRepositoryError>> {
    try {
        const { retryAt, now, attemptId, ...fields } = input;
        const record = await db.client.mutation(api.structure.completeStructureImportActionAttempt, {
            ...fields,
            attemptId: attemptId as Id<'structureImportActionAttempts'>,
            now: now.toISOString(),
            ...(retryAt ? { retryAt: retryAt.toISOString() } : {}),
        });
        return record ? ok(toAttempt(record)) : err({ type: 'not-found' });
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
        phase: 'preparing' | 'create' | 'update' | 'delete' | 'channel_order' | 'role_order';
        retryAt?: Date;
        skippedActions: number;
        state: 'applied' | 'failed' | 'unknown';
        status: 'running' | 'pause_requested';
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
                    ...(verificationResult ? { verificationResultJson: JSON.stringify(verificationResult) } : {}),
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}
