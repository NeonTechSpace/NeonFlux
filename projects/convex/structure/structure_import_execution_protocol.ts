import type { MutationCtx } from '../_generated/server.js';
import { STRUCTURE_EXECUTION_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { classifyStructureImportExecutionReclaim } from './structure_model.js';

type StructureExecutionProtocolRecord = {
    _id: unknown;
    appliedActions: number;
    completedMutationSteps: number;
    guildId: string;
    leaseExpiresAt?: string;
    nextActionSequence: number;
    protocolVersion: number;
    restorePointBackupId?: string;
    retryAt?: string;
    startedAt?: string;
    status: string;
};

export type StructureExecutionProtocolMismatch = {
    executionId: string;
    executionProtocolVersion: number;
    guildId: string;
    kind: 'protocol_mismatch';
    mayHaveExternalEffects: boolean;
    requiredProtocolVersion: number;
    status: string;
};

export function assertCurrentStructureExecutionProtocol(
    execution: Pick<StructureExecutionProtocolRecord, '_id' | 'protocolVersion'>
): void {
    if (execution.protocolVersion === STRUCTURE_EXECUTION_PROTOCOL_VERSION) return;

    throw new Error(
        `Execution protocolVersion mismatch for ${String(execution._id)}: expected ${String(STRUCTURE_EXECUTION_PROTOCOL_VERSION)}, received ${String(execution.protocolVersion)}`
    );
}

export function toStructureExecutionProtocolMismatch(
    execution: StructureExecutionProtocolRecord
): StructureExecutionProtocolMismatch {
    return {
        executionId: String(execution._id),
        executionProtocolVersion: execution.protocolVersion,
        guildId: execution.guildId,
        kind: 'protocol_mismatch',
        mayHaveExternalEffects:
            execution.startedAt !== undefined ||
            execution.appliedActions > 0 ||
            execution.completedMutationSteps > 0 ||
            execution.nextActionSequence > 0 ||
            execution.restorePointBackupId !== undefined,
        requiredProtocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
        status: execution.status,
    };
}

export function isRunnableStructureExecutionProtocolMismatch(
    execution: StructureExecutionProtocolRecord,
    now: string
): boolean {
    if (execution.protocolVersion === STRUCTURE_EXECUTION_PROTOCOL_VERSION) return false;
    switch (execution.status) {
        case 'queued':
            return true;
        case 'waiting_rate_limit':
            return execution.retryAt !== undefined && execution.retryAt <= now;
        case 'running':
        case 'pause_requested':
        case 'verifying':
            return (
                classifyStructureImportExecutionReclaim({
                    hasStartedAttempt: false,
                    ...(execution.leaseExpiresAt ? { leaseExpiresAt: execution.leaseExpiresAt } : {}),
                    now,
                }) !== 'active'
            );
        default:
            return false;
    }
}

export async function findCurrentQueuedOrWaitingStructureExecution(ctx: MutationCtx, now: string) {
    const queued = await ctx.db
        .query('structureImportExecutions')
        .withIndex('by_status_protocol_retry', (q) =>
            q.eq('status', 'queued').eq('protocolVersion', STRUCTURE_EXECUTION_PROTOCOL_VERSION)
        )
        .first();
    if (queued) return queued;

    return ctx.db
        .query('structureImportExecutions')
        .withIndex('by_status_protocol_retry', (q) =>
            q
                .eq('status', 'waiting_rate_limit')
                .eq('protocolVersion', STRUCTURE_EXECUTION_PROTOCOL_VERSION)
                .lte('retryAt', now)
        )
        .first();
}

export function listCurrentStructureExecutionReclaimCandidates(
    ctx: MutationCtx,
    status: 'pause_requested' | 'running' | 'verifying'
) {
    return ctx.db
        .query('structureImportExecutions')
        .withIndex('by_status_protocol_retry', (q) =>
            q.eq('status', status).eq('protocolVersion', STRUCTURE_EXECUTION_PROTOCOL_VERSION)
        )
        .collect();
}

export async function findRunnableStructureExecutionProtocolMismatch(
    ctx: MutationCtx,
    now: string
): Promise<StructureExecutionProtocolMismatch | null> {
    const queued = await findMismatchedByStatus(ctx, 'queued');
    if (queued && isRunnableStructureExecutionProtocolMismatch(queued, now)) {
        return toStructureExecutionProtocolMismatch(queued);
    }

    const waiting = await findMismatchedByStatus(ctx, 'waiting_rate_limit', now);
    if (waiting && isRunnableStructureExecutionProtocolMismatch(waiting, now)) {
        return toStructureExecutionProtocolMismatch(waiting);
    }

    for (const status of ['running', 'pause_requested', 'verifying'] as const) {
        const candidates = await ctx.db
            .query('structureImportExecutions')
            .withIndex('by_status_retry', (q) => q.eq('status', status))
            // This diagnostic fallback runs only after no current-protocol work exists; indexes cannot express !=.
            // eslint-disable-next-line @convex-dev/no-filter-in-query
            .filter((q) => q.neq(q.field('protocolVersion'), STRUCTURE_EXECUTION_PROTOCOL_VERSION))
            .collect();
        for (const candidate of candidates) {
            if (isRunnableStructureExecutionProtocolMismatch(candidate, now)) {
                return toStructureExecutionProtocolMismatch(candidate);
            }
        }
    }

    return null;
}

function findMismatchedByStatus(ctx: MutationCtx, status: 'queued' | 'waiting_rate_limit', retryAt?: string) {
    return (
        ctx.db
            .query('structureImportExecutions')
            .withIndex('by_status_retry', (q) =>
                retryAt === undefined ? q.eq('status', status) : q.eq('status', status).lte('retryAt', retryAt)
            )
            // This diagnostic fallback runs only after no current-protocol work exists; indexes cannot express !=.
            // eslint-disable-next-line @convex-dev/no-filter-in-query
            .filter((q) => q.neq(q.field('protocolVersion'), STRUCTURE_EXECUTION_PROTOCOL_VERSION))
            .first()
    );
}
