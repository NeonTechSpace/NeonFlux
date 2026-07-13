import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { recordBotActionEventInMutation } from '../core/events.js';
import { mutation, query, type MutationCtx } from '../_generated/server.js';
import { recordPostedMessageInMutation } from './posting.js';
import {
    dashboardPostingOperationRecordValidator,
    dashboardPostingOperationWorkerRecordValidator,
    normalizeBoundedOperationText,
    normalizeOptionalOperationText,
    toDashboardPostingOperationRecord,
    toDashboardPostingOperationWorkerRecord,
    type StoredDashboardPostingOperation,
} from './posting_operation_model.js';
import { isPostingGuildRunnable } from './posting_operations.js';

const botService = ['bot'] as const;
const operationOrNullValidator = v.union(dashboardPostingOperationWorkerRecordValidator, v.null());
const operationRecordOrNullValidator = v.union(dashboardPostingOperationRecordValidator, v.null());
const terminalRetentionMs = 30 * 24 * 60 * 60 * 1000;

export const claimNextDashboardPostingOperation = mutation({
    args: { leaseExpiresAt: v.string(), leaseId: v.string(), leaseOwner: v.string(), now: v.string() },
    returns: operationOrNullValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        requireValidLeaseWindow(args.now, args.leaseExpiresAt);
        const candidates = await findClaimCandidates(ctx, args.now);
        for (const candidate of candidates) {
            if (!(await isPostingGuildRunnable(ctx, candidate.guildId))) {
                await markTerminal(ctx, candidate, {
                    errorCode: 'guild_out_of_scope',
                    now: args.now,
                    status: 'permanent_failure',
                });
                continue;
            }
            if (candidate.status === 'running' && candidate.sendStartedAt && !candidate.externalMessageId) {
                await markTerminal(ctx, candidate, {
                    errorCode: 'send_outcome_unknown_after_lease_expiry',
                    now: args.now,
                    status: 'unknown',
                });
                continue;
            }

            const patch = {
                attemptCount: (candidate.attemptCount ?? 0) + 1,
                errorCode: undefined,
                leaseExpiresAt: args.leaseExpiresAt,
                leaseId: normalizeBoundedOperationText(args.leaseId, 'lease-id'),
                leaseOwner: normalizeBoundedOperationText(args.leaseOwner, 'lease-owner'),
                nextAttemptAt: undefined,
                status: 'running' as const,
                updatedAt: args.now,
            };
            await ctx.db.patch('dashboardPostingOperations', candidate._id, patch);
            const claimed: StoredDashboardPostingOperation = { ...candidate };
            Object.assign(claimed, {
                attemptCount: patch.attemptCount,
                leaseExpiresAt: patch.leaseExpiresAt,
                leaseId: patch.leaseId,
                leaseOwner: patch.leaseOwner,
                status: patch.status,
                updatedAt: patch.updatedAt,
            });
            delete claimed.errorCode;
            delete claimed.nextAttemptAt;
            return toDashboardPostingOperationWorkerRecord(claimed);
        }
        return null;
    },
});

export const readDashboardPostingOperationForWorker = query({
    args: { operationId: v.string() },
    returns: operationOrNullValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await ctx.db.get('dashboardPostingOperations', parseOperationId(args.operationId));
        return operation ? toDashboardPostingOperationWorkerRecord(operation) : null;
    },
});

export const markDashboardPostingOperationSendStarted = mutation({
    args: { leaseId: v.string(), now: v.string(), operationId: v.string() },
    returns: operationOrNullValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedRunning(ctx, args.operationId, args.leaseId, args.now);
        if (!operation || operation.externalMessageId)
            return operation ? toDashboardPostingOperationWorkerRecord(operation) : null;
        const sendStartedAt = operation.sendStartedAt ?? args.now;
        await ctx.db.patch('dashboardPostingOperations', operation._id, { sendStartedAt, updatedAt: args.now });
        return toDashboardPostingOperationWorkerRecord({ ...operation, sendStartedAt, updatedAt: args.now });
    },
});

export const recordDashboardPostingOperationExternalMessage = mutation({
    args: {
        externalChannelId: v.string(),
        externalMessageId: v.string(),
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: operationOrNullValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedRunning(ctx, args.operationId, args.leaseId, args.now);
        if (!operation?.sendStartedAt) return null;
        const externalMessageId = normalizeBoundedOperationText(args.externalMessageId, 'external-message-id');
        const externalChannelId = normalizeBoundedOperationText(args.externalChannelId, 'external-channel-id');
        if (
            operation.externalMessageId &&
            (operation.externalMessageId !== externalMessageId || operation.externalChannelId !== externalChannelId)
        ) {
            throw new Error('posting-external-message-conflict');
        }
        const patch = { externalChannelId, externalMessageId, updatedAt: args.now };
        await ctx.db.patch('dashboardPostingOperations', operation._id, patch);
        return toDashboardPostingOperationWorkerRecord({ ...operation, ...patch });
    },
});

export const deferDashboardPostingOperationBeforeSend = mutation({
    args: {
        errorCode: v.string(),
        leaseId: v.string(),
        nextAttemptAt: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedRunning(ctx, args.operationId, args.leaseId, args.now);
        if (!operation || operation.sendStartedAt) return false;
        await ctx.db.patch('dashboardPostingOperations', operation._id, {
            errorCode: normalizeBoundedOperationText(args.errorCode, 'error-code'),
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            nextAttemptAt: args.nextAttemptAt,
            status: 'queued',
            updatedAt: args.now,
        });
        return true;
    },
});

export const failDashboardPostingOperationPermanently = mutation({
    args: {
        channelName: v.optional(v.string()),
        errorCode: v.string(),
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: operationRecordOrNullValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedRunning(ctx, args.operationId, args.leaseId, args.now);
        if (!operation || operation.sendStartedAt) return null;
        return markTerminal(ctx, operation, {
            ...(args.channelName ? { channelName: args.channelName } : {}),
            errorCode: normalizeBoundedOperationText(args.errorCode, 'error-code'),
            now: args.now,
            status: 'permanent_failure',
        });
    },
});

export const markDashboardPostingOperationUnknown = mutation({
    args: {
        channelName: v.optional(v.string()),
        errorCode: v.string(),
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: operationRecordOrNullValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedRunning(ctx, args.operationId, args.leaseId, args.now);
        if (!operation?.sendStartedAt || operation.externalMessageId) return null;
        return markTerminal(ctx, operation, {
            ...(args.channelName ? { channelName: args.channelName } : {}),
            errorCode: normalizeBoundedOperationText(args.errorCode, 'error-code'),
            now: args.now,
            status: 'unknown',
        });
    },
});

export const completeDashboardPostingOperationSent = mutation({
    args: { channelName: v.optional(v.string()), leaseId: v.string(), now: v.string(), operationId: v.string() },
    returns: operationRecordOrNullValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const id = parseOperationId(args.operationId);
        const operation = await ctx.db.get('dashboardPostingOperations', id);
        if (!operation) return null;
        if (operation.status === 'sent') return toDashboardPostingOperationRecord(operation);
        if (!hasActiveLease(operation, args.leaseId, args.now)) return null;
        if (!operation.externalMessageId || !operation.externalChannelId) return null;

        await recordPostedMessageInMutation(ctx, {
            channelId: operation.externalChannelId,
            createdByUserId: operation.actorUserId,
            guildId: operation.guildId,
            messageId: operation.externalMessageId,
            purpose: 'dashboard',
        });
        const completed = await markTerminal(ctx, operation, {
            ...(args.channelName ? { channelName: args.channelName } : {}),
            messageId: operation.externalMessageId,
            now: args.now,
            sentChannelId: operation.externalChannelId,
            status: 'sent',
        });
        return completed;
    },
});

async function findClaimCandidates(ctx: MutationCtx, now: string): Promise<StoredDashboardPostingOperation[]> {
    const queued = await ctx.db
        .query('dashboardPostingOperations')
        .withIndex('by_status_next_attempt', (candidate) => candidate.eq('status', 'queued'))
        .take(25);
    const running = await ctx.db
        .query('dashboardPostingOperations')
        .withIndex('by_status_lease_expiry', (candidate) => candidate.eq('status', 'running').lt('leaseExpiresAt', now))
        .take(25);
    return [
        ...queued.filter((operation) => !operation.nextAttemptAt || operation.nextAttemptAt <= now),
        ...running,
    ].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left._creationTime - right._creationTime);
}

async function requireLeasedRunning(ctx: MutationCtx, operationId: string, leaseId: string, now: string) {
    const operation = await ctx.db.get('dashboardPostingOperations', parseOperationId(operationId));
    return operation && hasActiveLease(operation, leaseId, now) ? operation : null;
}

function hasActiveLease(operation: StoredDashboardPostingOperation, leaseId: string, now: string): boolean {
    return hasActiveDashboardPostingOperationLease(operation, leaseId, now);
}

export function hasActiveDashboardPostingOperationLease(
    operation: Pick<StoredDashboardPostingOperation, 'leaseExpiresAt' | 'leaseId' | 'status'>,
    leaseId: string,
    now: string
): boolean {
    const leaseExpiry = operation.leaseExpiresAt ? Date.parse(operation.leaseExpiresAt) : Number.NaN;
    const mutationTime = Date.parse(now);
    return (
        operation.status === 'running' &&
        operation.leaseId === leaseId.trim() &&
        Number.isFinite(leaseExpiry) &&
        Number.isFinite(mutationTime) &&
        leaseExpiry > mutationTime
    );
}

function requireValidLeaseWindow(now: string, leaseExpiresAt: string): void {
    const nowTime = Date.parse(now);
    const expiryTime = Date.parse(leaseExpiresAt);
    if (!Number.isFinite(nowTime) || !Number.isFinite(expiryTime) || expiryTime <= nowTime) {
        throw new Error('posting-lease-window-invalid');
    }
}

async function markTerminal(
    ctx: MutationCtx,
    operation: StoredDashboardPostingOperation,
    input: {
        channelName?: string;
        errorCode?: string;
        messageId?: string;
        now: string;
        sentChannelId?: string;
        status: 'permanent_failure' | 'sent' | 'unknown';
    }
) {
    const channelName = normalizeOptionalOperationText(input.channelName, 'channel-name');
    const completedAt = operation.completedAt ?? input.now;
    const patch = {
        completedAt,
        content: undefined,
        embeds: undefined,
        errorCode: input.errorCode,
        expiresAt: new Date(Date.parse(completedAt) + terminalRetentionMs).toISOString(),
        externalChannelId: undefined,
        externalMessageId: undefined,
        leaseExpiresAt: undefined,
        leaseId: undefined,
        leaseOwner: undefined,
        ...(input.messageId ? { messageId: input.messageId } : {}),
        nextAttemptAt: undefined,
        sendStartedAt: undefined,
        ...(input.sentChannelId ? { sentChannelId: input.sentChannelId } : {}),
        status: input.status,
        updatedAt: input.now,
    };
    await ctx.db.patch('dashboardPostingOperations', operation._id, patch);
    await recordBotActionEventInMutation(ctx, {
        action:
            input.status === 'sent'
                ? 'message.sent'
                : input.status === 'unknown'
                  ? 'message.delivery_unknown'
                  : 'message.delivery_failed',
        actorUserId: operation.actorUserId,
        feature: 'posting',
        guildId: operation.guildId,
        metadata: {
            ...(operation.actorDisplayName ? { actorDisplayName: operation.actorDisplayName } : {}),
            ...(operation.actorUsername ? { actorUsername: operation.actorUsername } : {}),
            ...(channelName ? { channelName } : {}),
            channelId: input.sentChannelId ?? operation.requestedChannelId,
            contentLength: operation.contentLength ?? operation.content?.length ?? 0,
            embedCount: operation.embedCount ?? operation.embeds?.length ?? 0,
            ...(input.errorCode ? { errorCode: input.errorCode } : {}),
            ...(input.messageId ? { messageId: input.messageId } : {}),
            source: 'dashboard',
        },
        ...(input.messageId ? { targetId: input.messageId } : {}),
    });
    const terminal: StoredDashboardPostingOperation = {
        ...operation,
        completedAt,
        expiresAt: patch.expiresAt,
        status: input.status,
        updatedAt: input.now,
    };
    delete terminal.content;
    delete terminal.embeds;
    delete terminal.errorCode;
    delete terminal.externalChannelId;
    delete terminal.externalMessageId;
    delete terminal.leaseExpiresAt;
    delete terminal.leaseId;
    delete terminal.leaseOwner;
    delete terminal.messageId;
    delete terminal.nextAttemptAt;
    delete terminal.sendStartedAt;
    delete terminal.sentChannelId;
    if (input.errorCode) terminal.errorCode = input.errorCode;
    if (input.messageId) terminal.messageId = input.messageId;
    if (input.sentChannelId) terminal.sentChannelId = input.sentChannelId;
    return toDashboardPostingOperationRecord(terminal);
}

function parseOperationId(id: string): GenericId<'dashboardPostingOperations'> {
    return normalizeBoundedOperationText(id, 'operation-id') as GenericId<'dashboardPostingOperations'>;
}
