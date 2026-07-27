import type { MutationCtx } from '../_generated/server.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { classifyBlueprintRunReclaim } from './blueprint_run_model.js';

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
    requiredProtocolVersion: typeof BLUEPRINT_RUN_PROTOCOL_VERSION;
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

export function findCurrentBlueprintRunReclaimCandidate(
    ctx: MutationCtx,
    status: 'pause_requested' | 'running' | 'verifying',
    now: string
) {
    return ctx.db
        .query('blueprintRuns')
        .withIndex('by_status_protocol_lease_expiry', (q) =>
            q.eq('status', status).eq('protocolVersion', BLUEPRINT_RUN_PROTOCOL_VERSION).lte('leaseExpiresAt', now)
        )
        .first();
}

export async function findRunnableBlueprintRunProtocolMismatch(
    ctx: MutationCtx
): Promise<BlueprintRunProtocolMismatch | null> {
    for (const status of ['queued', 'waiting_rate_limit', 'running', 'pause_requested', 'verifying'] as const) {
        const candidate = await findMismatchedByStatus(ctx, status);
        if (candidate) return toBlueprintRunProtocolMismatch(candidate);
    }

    return null;
}

async function findMismatchedByStatus(
    ctx: MutationCtx,
    status: 'queued' | 'waiting_rate_limit' | 'running' | 'pause_requested' | 'verifying'
) {
    const older = await ctx.db
        .query('blueprintRuns')
        .withIndex('by_status_protocol_retry', (q) =>
            q.eq('status', status).lt('protocolVersion', BLUEPRINT_RUN_PROTOCOL_VERSION)
        )
        .first();
    if (older) return older;
    return ctx.db
        .query('blueprintRuns')
        .withIndex('by_status_protocol_retry', (q) =>
            q.eq('status', status).gt('protocolVersion', BLUEPRINT_RUN_PROTOCOL_VERSION)
        )
        .first();
}
