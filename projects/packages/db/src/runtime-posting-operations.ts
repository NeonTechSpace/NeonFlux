import { api } from '@neonflux/convex-api';
import {
    parseOutgoingMessage,
    type DashboardPostingOperationResolution,
    type OutgoingEmbed,
    type OutgoingMessage,
} from '@neonflux/messaging';
import { err, ok, type Result } from 'neverthrow';

import type {
    DashboardPostingOperationRecord,
    DashboardPostingOperationRepositoryError,
    DashboardPostingOperationWorkerRecord,
} from './contracts.js';
import type { ConvexDatabase } from './convex.js';

type OperationResult<T> = Promise<Result<T, DashboardPostingOperationRepositoryError>>;

type ConvexOperationRecord = Omit<
    DashboardPostingOperationRecord,
    'completedAt' | 'createdAt' | 'nextAttemptAt' | 'resolvedAt' | 'updatedAt'
> & {
    completedAt: string | null;
    createdAt: string;
    nextAttemptAt: string | null;
    resolvedAt: string | null;
    updatedAt: string;
};

type ConvexWorkerRecord = Omit<
    DashboardPostingOperationWorkerRecord,
    'completedAt' | 'createdAt' | 'leaseExpiresAt' | 'nextAttemptAt' | 'resolvedAt' | 'sendStartedAt' | 'updatedAt'
> & {
    completedAt: string | null;
    createdAt: string;
    leaseExpiresAt: string | null;
    nextAttemptAt: string | null;
    resolvedAt: string | null;
    sendStartedAt: string | null;
    updatedAt: string;
};

export function normalizeDashboardPostingPayload(input: {
    content?: string;
    embeds?: unknown;
}): Result<OutgoingMessage, DashboardPostingOperationRepositoryError> {
    const parsed = parseOutgoingMessage({
        ...(input.content === undefined ? {} : { content: input.content }),
        embeds: input.embeds ?? [],
    });
    return parsed.isOk()
        ? ok(parsed.value)
        : err(
              parsed.error.code === 'empty-message'
                  ? { field: 'message', type: 'missing-input' }
                  : { field: 'message', type: 'invalid-value' }
          );
}

export async function enqueueDashboardPostingOperation(
    db: Pick<ConvexDatabase, 'client'>,
    input: {
        allowMassMentions?: boolean;
        content?: string;
        embeds?: OutgoingEmbed[];
        guildId: string;
        payloadHash: string;
        requestKey: string;
        requestedChannelId: string;
        retryOfOperationId?: string;
    }
): OperationResult<{ created: boolean; operation: DashboardPostingOperationRecord }> {
    const payload = normalizeDashboardPostingPayload(input);
    if (payload.isErr()) return err(payload.error);
    try {
        const result = await db.client.mutation(api.posting.enqueueDashboardPostingOperation, {
            ...input,
            ...payload.value,
        });
        return ok({ created: result.created, operation: toOperationRecord(result.operation) });
    } catch (errorValue) {
        return err(mapOperationError(errorValue));
    }
}

export async function resolveDashboardPostingOperationUnknown(
    db: ConvexDatabase,
    input: {
        actorDisplayName?: string;
        actorUsername?: string;
        actorUserId: string;
        guildId: string;
        operationId: string;
        resolution: Exclude<DashboardPostingOperationResolution, 'duplicate_risk_accepted'>;
    }
): OperationResult<DashboardPostingOperationRecord> {
    try {
        const record = await db.client.mutation(api.posting.resolveDashboardPostingOperationUnknown, input);
        return ok(toOperationRecord(record));
    } catch (errorValue) {
        return err(mapOperationError(errorValue));
    }
}

export async function listDashboardPostingOperationsByGuild(
    db: ConvexDatabase,
    input: { guildId: string; limit?: number }
): OperationResult<DashboardPostingOperationRecord[]> {
    try {
        const result = await db.client.query(api.posting.listDashboardPostingOperationsByGuild, input);
        return ok(result.operations.map(toOperationRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function claimNextDashboardPostingOperation(
    db: ConvexDatabase,
    input: { leaseExpiresAt: Date; leaseId: string; leaseOwner: string; now: Date }
): OperationResult<DashboardPostingOperationWorkerRecord | null> {
    return workerMutation(db, api.posting.claimNextDashboardPostingOperation, {
        leaseExpiresAt: input.leaseExpiresAt.toISOString(),
        leaseId: input.leaseId,
        leaseOwner: input.leaseOwner,
        now: input.now.toISOString(),
    });
}

export async function readDashboardPostingOperationForWorker(
    db: ConvexDatabase,
    input: { operationId: string }
): OperationResult<DashboardPostingOperationWorkerRecord | null> {
    try {
        const record = await db.client.query(api.posting.readDashboardPostingOperationForWorker, input);
        return ok(record ? toWorkerRecord(record) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function isDashboardPostingGuildRunnable(
    db: ConvexDatabase,
    input: { guildId: string }
): OperationResult<boolean> {
    try {
        return ok(await db.client.query(api.posting.isDashboardPostingGuildRunnable, input));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function markDashboardPostingOperationSendStarted(
    db: ConvexDatabase,
    input: { leaseId: string; now: Date; operationId: string }
): OperationResult<DashboardPostingOperationWorkerRecord | null> {
    return workerMutation(db, api.posting.markDashboardPostingOperationSendStarted, toWorkerInput(input));
}

export async function recordDashboardPostingOperationExternalMessage(
    db: ConvexDatabase,
    input: {
        externalChannelId: string;
        externalMessageId: string;
        leaseId: string;
        now: Date;
        operationId: string;
    }
): OperationResult<DashboardPostingOperationWorkerRecord | null> {
    return workerMutation(db, api.posting.recordDashboardPostingOperationExternalMessage, toWorkerInput(input));
}

export async function deferDashboardPostingOperationBeforeSend(
    db: ConvexDatabase,
    input: { errorCode: string; leaseId: string; nextAttemptAt: Date; now: Date; operationId: string }
): OperationResult<boolean> {
    return booleanMutation(db, api.posting.deferDashboardPostingOperationBeforeSend, {
        ...toWorkerInput(input),
        errorCode: input.errorCode,
        nextAttemptAt: input.nextAttemptAt.toISOString(),
    });
}

export async function failDashboardPostingOperationPermanently(
    db: ConvexDatabase,
    input: { channelName?: string; errorCode: string; leaseId: string; now: Date; operationId: string }
): OperationResult<DashboardPostingOperationRecord | null> {
    return operationMutation(db, api.posting.failDashboardPostingOperationPermanently, toWorkerInput(input));
}

export async function markDashboardPostingOperationUnknown(
    db: ConvexDatabase,
    input: { channelName?: string; errorCode: string; leaseId: string; now: Date; operationId: string }
): OperationResult<DashboardPostingOperationRecord | null> {
    return operationMutation(db, api.posting.markDashboardPostingOperationUnknown, toWorkerInput(input));
}

export async function completeDashboardPostingOperationSent(
    db: ConvexDatabase,
    input: { channelName?: string; leaseId: string; now: Date; operationId: string }
): OperationResult<DashboardPostingOperationRecord | null> {
    return operationMutation(db, api.posting.completeDashboardPostingOperationSent, toWorkerInput(input));
}

async function workerMutation(
    db: ConvexDatabase,
    reference: Parameters<ConvexDatabase['client']['mutation']>[0],
    args: Record<string, unknown>
): OperationResult<DashboardPostingOperationWorkerRecord | null> {
    try {
        const record = (await db.client.mutation(reference, args)) as ConvexWorkerRecord | null;
        return ok(record ? toWorkerRecord(record) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

async function operationMutation(
    db: ConvexDatabase,
    reference: Parameters<ConvexDatabase['client']['mutation']>[0],
    args: Record<string, unknown>
): OperationResult<DashboardPostingOperationRecord | null> {
    try {
        const record = (await db.client.mutation(reference, args)) as ConvexOperationRecord | null;
        return ok(record ? toOperationRecord(record) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

async function booleanMutation(
    db: ConvexDatabase,
    reference: Parameters<ConvexDatabase['client']['mutation']>[0],
    args: Record<string, unknown>
): OperationResult<boolean> {
    try {
        return ok((await db.client.mutation(reference, args)) as boolean);
    } catch {
        return err({ type: 'database-error' });
    }
}

function toWorkerInput<T extends { now: Date }>(input: T) {
    return { ...input, now: input.now.toISOString() };
}

function toOperationRecord(record: ConvexOperationRecord): DashboardPostingOperationRecord {
    return {
        ...record,
        completedAt: toOptionalDate(record.completedAt),
        createdAt: new Date(record.createdAt),
        nextAttemptAt: toOptionalDate(record.nextAttemptAt),
        resolvedAt: toOptionalDate(record.resolvedAt),
        status: record.status,
        updatedAt: new Date(record.updatedAt),
    };
}

function toWorkerRecord(record: ConvexWorkerRecord): DashboardPostingOperationWorkerRecord {
    return {
        ...toOperationRecord(record),
        content: record.content,
        embeds: record.embeds,
        externalChannelId: record.externalChannelId,
        externalMessageId: record.externalMessageId,
        leaseExpiresAt: toOptionalDate(record.leaseExpiresAt),
        leaseId: record.leaseId,
        leaseOwner: record.leaseOwner,
        sendStartedAt: toOptionalDate(record.sendStartedAt),
    };
}

function toOptionalDate(value: string | null): Date | null {
    return value ? new Date(value) : null;
}

function mapOperationError(errorValue: unknown): DashboardPostingOperationRepositoryError {
    const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
    if (message.includes('posting-request-key-conflict') || message.includes('posting-retry-already-created')) {
        return { field: 'requestKey', type: 'conflict' };
    }
    if (message.includes('posting-resolution-conflict')) return { field: 'resolution', type: 'conflict' };
    return { type: 'database-error' };
}
