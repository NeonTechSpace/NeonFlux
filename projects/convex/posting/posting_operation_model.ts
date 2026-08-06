import { v, type GenericId } from 'convex/values';
import {
    parseOutgoingMessage,
    type DashboardPostingOperationResolution,
    type OutgoingEmbed,
    type OutgoingMessage,
} from '@neonflux/messaging';

import { dashboardPostingOperationResolutionValidator, outgoingEmbedValidator } from './message_validators.js';

export const dashboardPostingOperationStatuses = ['queued', 'running', 'unknown', 'sent', 'permanent_failure'] as const;

export type DashboardPostingOperationStatus = (typeof dashboardPostingOperationStatuses)[number];

export type StoredDashboardPostingOperation = {
    _creationTime: number;
    _id: GenericId<'dashboardPostingOperations'>;
    actorDisplayName?: string;
    actorUsername?: string;
    actorUserId: string;
    allowMassMentions?: boolean;
    attemptCount?: number;
    completedAt?: string;
    content?: string;
    contentLength?: number;
    createdAt: string;
    embeds?: OutgoingEmbed[];
    embedCount?: number;
    errorCode?: string;
    expiresAt?: string;
    externalChannelId?: string;
    externalMessageId?: string;
    followupOperationId?: string;
    guildId: string;
    leaseExpiresAt?: string;
    leaseId?: string;
    leaseOwner?: string;
    messageId?: string;
    nextAttemptAt?: string;
    payloadHash: string;
    requestKey: string;
    requestedChannelId: string;
    resolution?: DashboardPostingOperationResolution;
    resolvedAt?: string;
    resolvedByUserId?: string;
    retryOfOperationId?: string;
    sendStartedAt?: string;
    sentChannelId?: string;
    status: DashboardPostingOperationStatus;
    updatedAt: string;
};

export type NormalizedDashboardPostingPayload = OutgoingMessage;

const dashboardPostingOperationRecordFields = {
    actorDisplayName: v.union(v.string(), v.null()),
    actorUsername: v.union(v.string(), v.null()),
    actorUserId: v.string(),
    allowMassMentions: v.boolean(),
    attemptCount: v.number(),
    completedAt: v.union(v.string(), v.null()),
    contentLength: v.number(),
    createdAt: v.string(),
    embedCount: v.number(),
    errorCode: v.union(v.string(), v.null()),
    followupOperationId: v.union(v.string(), v.null()),
    guildId: v.string(),
    id: v.string(),
    messageId: v.union(v.string(), v.null()),
    nextAttemptAt: v.union(v.string(), v.null()),
    requestKey: v.string(),
    requestedChannelId: v.string(),
    resolution: v.union(dashboardPostingOperationResolutionValidator, v.null()),
    resolvedAt: v.union(v.string(), v.null()),
    resolvedByUserId: v.union(v.string(), v.null()),
    retryOfOperationId: v.union(v.string(), v.null()),
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
    embeds: v.array(outgoingEmbedValidator),
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

export function normalizeDashboardPostingPayload(input: {
    content?: string;
    embeds?: unknown;
}): NormalizedDashboardPostingPayload {
    const parsed = parseOutgoingMessage({
        ...(input.content === undefined ? {} : { content: input.content }),
        embeds: input.embeds ?? [],
    });
    if (parsed.isErr()) throw new Error(`posting-message-invalid:${parsed.error.code}:${parsed.error.path}`);
    return parsed.value;
}

export function toDashboardPostingOperationRecord(operation: StoredDashboardPostingOperation) {
    return {
        actorDisplayName: operation.actorDisplayName ?? null,
        actorUsername: operation.actorUsername ?? null,
        actorUserId: operation.actorUserId,
        allowMassMentions: operation.allowMassMentions ?? false,
        attemptCount: operation.attemptCount ?? 0,
        completedAt: operation.completedAt ?? null,
        contentLength: operation.contentLength ?? operation.content?.length ?? 0,
        createdAt: operation.createdAt,
        embedCount: operation.embedCount ?? operation.embeds?.length ?? 0,
        errorCode: operation.errorCode ?? null,
        followupOperationId: operation.followupOperationId ?? null,
        guildId: operation.guildId,
        id: operation._id,
        messageId: operation.messageId ?? null,
        nextAttemptAt: operation.nextAttemptAt ?? null,
        requestKey: operation.requestKey,
        requestedChannelId: operation.requestedChannelId,
        resolution: operation.resolution ?? null,
        resolvedAt: operation.resolvedAt ?? null,
        resolvedByUserId: operation.resolvedByUserId ?? null,
        retryOfOperationId: operation.retryOfOperationId ?? null,
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
