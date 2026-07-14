import type { MutationCtx } from '../_generated/server.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { classifyBlueprintRunReclaim } from './blueprint_model.js';

type BlueprintRunProtocolRecord = {
    _id: unknown;
    appliedSteps: number;
    completedMutationSteps: number;
    guildId: string;
    leaseExpiresAt?: string;
    nextStepSequence: number;
    protocolVersion: number;
    restorePointBackupId?: string;
    retryAt?: string;
    startedAt?: string;
    status: string;
};

export type BlueprintRunProtocolMismatch = {
    runId: string;
    runProtocolVersion: number;
    guildId: string;
    kind: 'protocol_mismatch';
    mayHaveExternalEffects: boolean;
    requiredProtocolVersion: number;
    status: string;
};

export function assertCurrentBlueprintRunProtocol(
    run: Pick<BlueprintRunProtocolRecord, '_id' | 'protocolVersion'>
): void {
    if (run.protocolVersion === BLUEPRINT_RUN_PROTOCOL_VERSION) return;

    throw new Error(
        `Run protocolVersion mismatch for ${String(run._id)}: expected ${String(BLUEPRINT_RUN_PROTOCOL_VERSION)}, received ${String(run.protocolVersion)}`
    );
}

export function toBlueprintRunProtocolMismatch(run: BlueprintRunProtocolRecord): BlueprintRunProtocolMismatch {
    return {
        runId: String(run._id),
        runProtocolVersion: run.protocolVersion,
        guildId: run.guildId,
        kind: 'protocol_mismatch',
        mayHaveExternalEffects:
            run.startedAt !== undefined ||
            run.appliedSteps > 0 ||
            run.completedMutationSteps > 0 ||
            run.nextStepSequence > 0 ||
            run.restorePointBackupId !== undefined,
        requiredProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        status: run.status,
    };
}

export function isRunnableBlueprintRunProtocolMismatch(run: BlueprintRunProtocolRecord, now: string): boolean {
    if (run.protocolVersion === BLUEPRINT_RUN_PROTOCOL_VERSION) return false;
    switch (run.status) {
        case 'queued':
            return true;
        case 'waiting_rate_limit':
            return run.retryAt !== undefined && run.retryAt <= now;
        case 'running':
        case 'pause_requested':
        case 'verifying':
            return (
                classifyBlueprintRunReclaim({
                    hasStartedAttempt: false,
                    ...(run.leaseExpiresAt ? { leaseExpiresAt: run.leaseExpiresAt } : {}),
                    now,
                }) !== 'active'
            );
        default:
            return false;
    }
}

export async function findCurrentQueuedOrWaitingBlueprintRun(ctx: MutationCtx, now: string) {
    const queued = await ctx.db
        .query('blueprintRuns')
        .withIndex('by_status_protocol_retry', (q) =>
            q.eq('status', 'queued').eq('protocolVersion', BLUEPRINT_RUN_PROTOCOL_VERSION)
        )
        .first();
    if (queued) return queued;

    return ctx.db
        .query('blueprintRuns')
        .withIndex('by_status_protocol_retry', (q) =>
            q
                .eq('status', 'waiting_rate_limit')
                .eq('protocolVersion', BLUEPRINT_RUN_PROTOCOL_VERSION)
                .lte('retryAt', now)
        )
        .first();
}

export function listCurrentBlueprintRunReclaimCandidates(
    ctx: MutationCtx,
    status: 'pause_requested' | 'running' | 'verifying'
) {
    return ctx.db
        .query('blueprintRuns')
        .withIndex('by_status_protocol_retry', (q) =>
            q.eq('status', status).eq('protocolVersion', BLUEPRINT_RUN_PROTOCOL_VERSION)
        )
        .collect();
}

export async function findRunnableBlueprintRunProtocolMismatch(
    ctx: MutationCtx,
    now: string
): Promise<BlueprintRunProtocolMismatch | null> {
    const queued = await findMismatchedByStatus(ctx, 'queued');
    if (queued && isRunnableBlueprintRunProtocolMismatch(queued, now)) {
        return toBlueprintRunProtocolMismatch(queued);
    }

    const waiting = await findMismatchedByStatus(ctx, 'waiting_rate_limit', now);
    if (waiting && isRunnableBlueprintRunProtocolMismatch(waiting, now)) {
        return toBlueprintRunProtocolMismatch(waiting);
    }

    for (const status of ['running', 'pause_requested', 'verifying'] as const) {
        const candidates = await ctx.db
            .query('blueprintRuns')
            .withIndex('by_status_retry', (q) => q.eq('status', status))
            // This diagnostic fallback runs only after no current-protocol work exists; indexes cannot express !=.
            // eslint-disable-next-line @convex-dev/no-filter-in-query
            .filter((q) => q.neq(q.field('protocolVersion'), BLUEPRINT_RUN_PROTOCOL_VERSION))
            .collect();
        for (const candidate of candidates) {
            if (isRunnableBlueprintRunProtocolMismatch(candidate, now)) {
                return toBlueprintRunProtocolMismatch(candidate);
            }
        }
    }

    return null;
}

function findMismatchedByStatus(ctx: MutationCtx, status: 'queued' | 'waiting_rate_limit', retryAt?: string) {
    return (
        ctx.db
            .query('blueprintRuns')
            .withIndex('by_status_retry', (q) =>
                retryAt === undefined ? q.eq('status', status) : q.eq('status', status).lte('retryAt', retryAt)
            )
            // This diagnostic fallback runs only after no current-protocol work exists; indexes cannot express !=.
            // eslint-disable-next-line @convex-dev/no-filter-in-query
            .filter((q) => q.neq(q.field('protocolVersion'), BLUEPRINT_RUN_PROTOCOL_VERSION))
            .first()
    );
}
