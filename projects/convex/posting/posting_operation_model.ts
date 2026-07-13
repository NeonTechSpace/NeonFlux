import { v, type GenericId } from 'convex/values';

export const dashboardPostingOperationStatuses = ['queued', 'running', 'unknown', 'sent', 'permanent_failure'] as const;

export type DashboardPostingOperationStatus = (typeof dashboardPostingOperationStatuses)[number];

export type StoredDashboardPostingOperation = {
    _creationTime: number;
    _id: GenericId<'dashboardPostingOperations'>;
    actorDisplayName?: string;
    actorUsername?: string;
    actorUserId: string;
    attemptCount?: number;
    completedAt?: string;
    content?: string;
    contentLength?: number;
    createdAt: string;
    embeds?: unknown[];
    embedCount?: number;
    errorCode?: string;
    expiresAt?: string;
    externalChannelId?: string;
    externalMessageId?: string;
    guildId: string;
    leaseExpiresAt?: string;
    leaseId?: string;
    leaseOwner?: string;
    messageId?: string;
    nextAttemptAt?: string;
    payloadHash: string;
    requestKey: string;
    requestedChannelId: string;
    sendStartedAt?: string;
    sentChannelId?: string;
    status: DashboardPostingOperationStatus;
    updatedAt: string;
};

export type NormalizedDashboardPostingPayload = {
    content?: string;
    embeds: unknown[];
};

const dashboardPostingOperationRecordFields = {
    actorDisplayName: v.union(v.string(), v.null()),
    actorUsername: v.union(v.string(), v.null()),
    actorUserId: v.string(),
    attemptCount: v.number(),
    completedAt: v.union(v.string(), v.null()),
    contentLength: v.number(),
    createdAt: v.string(),
    embedCount: v.number(),
    errorCode: v.union(v.string(), v.null()),
    guildId: v.string(),
    id: v.string(),
    messageId: v.union(v.string(), v.null()),
    nextAttemptAt: v.union(v.string(), v.null()),
    requestKey: v.string(),
    requestedChannelId: v.string(),
    sentChannelId: v.union(v.string(), v.null()),
    status: v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('unknown'),
        v.literal('sent'),
        v.literal('permanent_failure')
    ),
    updatedAt: v.string(),
};

export const dashboardPostingOperationRecordValidator = v.object(dashboardPostingOperationRecordFields);

export const dashboardPostingOperationWorkerRecordValidator = v.object({
    ...dashboardPostingOperationRecordFields,
    content: v.union(v.string(), v.null()),
    embeds: v.array(v.any()),
    externalChannelId: v.union(v.string(), v.null()),
    externalMessageId: v.union(v.string(), v.null()),
    leaseExpiresAt: v.union(v.string(), v.null()),
    leaseId: v.union(v.string(), v.null()),
    leaseOwner: v.union(v.string(), v.null()),
    sendStartedAt: v.union(v.string(), v.null()),
});

export const dashboardPostingOperationEnqueueValidator = v.object({
    created: v.boolean(),
    operation: dashboardPostingOperationRecordValidator,
});

export const dashboardPostingOperationListValidator = v.object({
    operations: v.array(dashboardPostingOperationRecordValidator),
});

export const DASHBOARD_POSTING_PAYLOAD_MAX_BYTES = 128 * 1024;
export const DASHBOARD_POSTING_PAYLOAD_MAX_DEPTH = 20;

export function normalizeDashboardPostingPayload(input: {
    content?: string;
    embeds?: unknown[];
}): NormalizedDashboardPostingPayload {
    const content = input.content?.trim();
    const embeds = normalizeJsonArray(input.embeds ?? [], 0, new Set());

    if (!content && embeds.length === 0) {
        throw new Error('posting-message-empty');
    }

    const payload = {
        ...(content ? { content } : {}),
        embeds,
    };
    const serialized = JSON.stringify(payload);

    if (new TextEncoder().encode(serialized).byteLength > DASHBOARD_POSTING_PAYLOAD_MAX_BYTES) {
        throw new Error('posting-payload-too-large');
    }

    return payload;
}

export function toDashboardPostingOperationRecord(operation: StoredDashboardPostingOperation) {
    return {
        actorDisplayName: operation.actorDisplayName ?? null,
        actorUsername: operation.actorUsername ?? null,
        actorUserId: operation.actorUserId,
        attemptCount: operation.attemptCount ?? 0,
        completedAt: operation.completedAt ?? null,
        contentLength: operation.contentLength ?? operation.content?.length ?? 0,
        createdAt: operation.createdAt,
        embedCount: operation.embedCount ?? operation.embeds?.length ?? 0,
        errorCode: operation.errorCode ?? null,
        guildId: operation.guildId,
        id: operation._id,
        messageId: operation.messageId ?? null,
        nextAttemptAt: operation.nextAttemptAt ?? null,
        requestKey: operation.requestKey,
        requestedChannelId: operation.requestedChannelId,
        sentChannelId: operation.sentChannelId ?? null,
        status: operation.status,
        updatedAt: operation.updatedAt,
    };
}

export function toDashboardPostingOperationWorkerRecord(operation: StoredDashboardPostingOperation) {
    return {
        ...toDashboardPostingOperationRecord(operation),
        content: operation.content ?? null,
        embeds: operation.embeds ?? [],
        externalChannelId: operation.externalChannelId ?? null,
        externalMessageId: operation.externalMessageId ?? null,
        leaseExpiresAt: operation.leaseExpiresAt ?? null,
        leaseId: operation.leaseId ?? null,
        leaseOwner: operation.leaseOwner ?? null,
        sendStartedAt: operation.sendStartedAt ?? null,
    };
}

export function normalizeBoundedOperationText(value: string | undefined, field: string, maxLength = 128): string {
    const normalized = value?.trim();
    if (!normalized) throw new Error(`posting-${field}-missing`);
    if (normalized.length > maxLength) throw new Error(`posting-${field}-too-long`);
    return normalized;
}

export function normalizeOptionalOperationText(
    value: string | undefined,
    field: string,
    maxLength = 128
): string | undefined {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    if (normalized.length > maxLength) throw new Error(`posting-${field}-too-long`);
    return normalized;
}

function normalizeJsonArray(value: unknown, depth: number, seen: Set<object>): unknown[] {
    if (!Array.isArray(value)) throw new Error('posting-embeds-invalid');
    return normalizeJsonContainer(value, depth, seen, () =>
        value.map((item) => normalizeJsonValue(item, depth + 1, seen))
    );
}

function normalizeJsonValue(value: unknown, depth: number, seen: Set<object>): unknown {
    if (depth > DASHBOARD_POSTING_PAYLOAD_MAX_DEPTH) throw new Error('posting-payload-too-deep');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return normalizeJsonArray(value, depth, seen);
    if (!isPlainRecord(value)) throw new Error('posting-payload-not-json');

    return normalizeJsonContainer(value, depth, seen, () => {
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

function normalizeJsonContainer<T>(value: object, depth: number, seen: Set<object>, build: () => T): T {
    if (depth > DASHBOARD_POSTING_PAYLOAD_MAX_DEPTH) throw new Error('posting-payload-too-deep');
    if (seen.has(value)) throw new Error('posting-payload-circular');
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
