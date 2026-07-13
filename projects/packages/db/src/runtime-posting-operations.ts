import { api } from '@neonflux/convex-api';
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
    'completedAt' | 'createdAt' | 'nextAttemptAt' | 'updatedAt'
> & {
    completedAt: string | null;
    createdAt: string;
    nextAttemptAt: string | null;
    updatedAt: string;
};

type ConvexWorkerRecord = Omit<
    DashboardPostingOperationWorkerRecord,
    'completedAt' | 'createdAt' | 'leaseExpiresAt' | 'nextAttemptAt' | 'sendStartedAt' | 'updatedAt'
> & {
    completedAt: string | null;
    createdAt: string;
    leaseExpiresAt: string | null;
    nextAttemptAt: string | null;
    sendStartedAt: string | null;
    updatedAt: string;
};

export const DASHBOARD_POSTING_PAYLOAD_MAX_BYTES = 128 * 1024;
export const DASHBOARD_POSTING_PAYLOAD_MAX_DEPTH = 20;

export function normalizeDashboardPostingPayload(input: {
    content?: string;
    embeds?: unknown[];
}): Result<{ content?: string; embeds: unknown[] }, DashboardPostingOperationRepositoryError> {
    try {
        const content = input.content?.trim();
        const embeds = normalizeJsonArray(input.embeds ?? [], 0, new Set());
        if (!content && embeds.length === 0) return err({ field: 'message', type: 'missing-input' });
        const payload = { ...(content ? { content } : {}), embeds };
        if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > DASHBOARD_POSTING_PAYLOAD_MAX_BYTES) {
            return err({ field: 'message', type: 'invalid-value' });
        }
        return ok(payload);
    } catch {
        return err({ field: 'message', type: 'invalid-value' });
    }
}

export async function enqueueDashboardPostingOperation(
    db: ConvexDatabase,
    input: {
        actorDisplayName?: string;
        actorUsername?: string;
        actorUserId: string;
        content?: string;
        embeds?: unknown[];
        guildId: string;
        payloadHash: string;
        requestKey: string;
        requestedChannelId: string;
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
    return message.includes('posting-request-key-conflict')
        ? { field: 'requestKey', type: 'conflict' }
        : { type: 'database-error' };
}

function normalizeJsonArray(value: unknown, depth: number, seen: Set<object>): unknown[] {
    if (!Array.isArray(value)) throw new Error('invalid-array');
    return normalizeContainer(value, depth, seen, () =>
        value.map((child) => normalizeJsonValue(child, depth + 1, seen))
    );
}

function normalizeJsonValue(value: unknown, depth: number, seen: Set<object>): unknown {
    if (depth > DASHBOARD_POSTING_PAYLOAD_MAX_DEPTH) throw new Error('too-deep');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return normalizeJsonArray(value, depth, seen);
    if (!isPlainRecord(value)) throw new Error('not-json');
    return normalizeContainer(value, depth, seen, () => {
        const normalized: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
            Object.defineProperty(normalized, key, {
                configurable: true,
                enumerable: true,
                value: normalizeJsonValue(child, depth + 1, seen),
                writable: true,
            });
        }
        return normalized;
    });
}

function normalizeContainer<T>(value: object, depth: number, seen: Set<object>, build: () => T): T {
    if (depth > DASHBOARD_POSTING_PAYLOAD_MAX_DEPTH || seen.has(value)) throw new Error('invalid-container');
    seen.add(value);
    try {
        return build();
    } finally {
        seen.delete(value);
    }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
