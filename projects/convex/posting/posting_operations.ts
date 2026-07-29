import { v, type GenericId } from 'convex/values';
import { hashDashboardPostingPayload } from '@neonflux/messaging';

import { requireNeonFluxPostingDelegation, requireNeonFluxService } from '../auth.js';
import { internal } from '../_generated/api.js';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
import { recordBotActionEventInMutation } from '../core/events.js';
import { requireGuildDocument } from './posting.js';
import { dashboardPostingOperationResolutionValidator, outgoingEmbedValidator } from './message_validators.js';
import {
    dashboardPostingOperationEnqueueValidator,
    dashboardPostingOperationListValidator,
    dashboardPostingOperationRecordValidator,
    normalizeBoundedOperationText,
    normalizeDashboardPostingPayload,
    normalizeOptionalOperationText,
    toDashboardPostingOperationRecord,
    type StoredDashboardPostingOperation,
} from './posting_operation_model.js';

const webService = ['web'] as const;
const botService = ['bot'] as const;
const pruneBatchSize = 100;
const terminalStatuses = ['unknown', 'sent', 'permanent_failure'] as const;

export const enqueueDashboardPostingOperation = mutation({
    args: {
        content: v.optional(v.string()),
        embeds: v.optional(v.array(outgoingEmbedValidator)),
        guildId: v.string(),
        payloadHash: v.string(),
        requestKey: v.string(),
        requestedChannelId: v.string(),
        retryOfOperationId: v.optional(v.string()),
    },
    returns: dashboardPostingOperationEnqueueValidator,
    handler: async (ctx, args) => {
        const delegation = await requireNeonFluxPostingDelegation(ctx);
        const guildId = normalizeBoundedOperationText(args.guildId, 'guild-id');
        const requestKey = normalizeBoundedOperationText(args.requestKey, 'request-key');
        const payloadHash = normalizeBoundedOperationText(args.payloadHash, 'payload-hash');
        const requestedChannelId = normalizeBoundedOperationText(args.requestedChannelId, 'channel-id');
        const retryOfOperationId = normalizeOptionalOperationText(args.retryOfOperationId, 'retry-of-operation-id');
        const payload = normalizeDashboardPostingPayload(args);
        const computedPayloadHash = await hashDashboardPostingPayload(requestedChannelId, payload);

        if (
            computedPayloadHash !== payloadHash ||
            delegation.guildId !== guildId ||
            delegation.payloadHash !== payloadHash ||
            delegation.requestKey !== requestKey ||
            delegation.requestedChannelId !== requestedChannelId ||
            delegation.retryOfOperationId !== retryOfOperationId
        ) {
            throw new Error('posting-delegation-mismatch');
        }
        const actorUserId = delegation.actorUserId;

        await requireGuildDocument(ctx, guildId);
        const existing = await findByGuildRequest(ctx, guildId, requestKey);
        if (existing) {
            if (
                existing.actorUserId !== actorUserId ||
                existing.payloadHash !== payloadHash ||
                existing.requestedChannelId !== requestedChannelId ||
                existing.retryOfOperationId !== retryOfOperationId
            ) {
                throw new Error('posting-request-key-conflict');
            }
            return { created: false, operation: toDashboardPostingOperationRecord(existing) };
        }

        const retryOf = retryOfOperationId
            ? await requireDuplicateRiskRetryTarget(ctx, guildId, retryOfOperationId)
            : undefined;

        const now = new Date().toISOString();
        const id = await ctx.db.insert('dashboardPostingOperations', {
            actorUserId,
            attemptCount: 0,
            ...(payload.content ? { content: payload.content } : {}),
            contentLength: payload.content?.length ?? 0,
            createdAt: now,
            embeds: payload.embeds,
            embedCount: payload.embeds.length,
            guildId,
            payloadHash,
            requestKey,
            requestedChannelId,
            ...(retryOf ? { retryOfOperationId: retryOf._id } : {}),
            status: 'queued',
            updatedAt: now,
        });
        const operation = await ctx.db.get('dashboardPostingOperations', id);
        if (!operation) throw new Error('posting-operation-insert-failed');
        if (retryOf) {
            await ctx.db.patch('dashboardPostingOperations', retryOf._id, {
                followupOperationId: id,
                resolution: 'duplicate_risk_accepted',
                resolvedAt: now,
                resolvedByUserId: actorUserId,
                updatedAt: now,
            });
            await recordResolutionEvent(ctx, retryOf, {
                actorUserId,
                followupOperationId: id,
                now,
                resolution: 'duplicate_risk_accepted',
            });
        }
        return { created: true, operation: toDashboardPostingOperationRecord(operation) };
    },
});

export const resolveDashboardPostingOperationUnknown = mutation({
    args: {
        actorDisplayName: v.optional(v.string()),
        actorUsername: v.optional(v.string()),
        actorUserId: v.string(),
        guildId: v.string(),
        operationId: v.string(),
        resolution: dashboardPostingOperationResolutionValidator,
    },
    returns: dashboardPostingOperationRecordValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, webService);
        const guildId = normalizeBoundedOperationText(args.guildId, 'guild-id');
        const actorUserId = normalizeBoundedOperationText(args.actorUserId, 'actor-user-id');
        const actorUsername = normalizeOptionalOperationText(args.actorUsername, 'actor-username');
        const actorDisplayName = normalizeOptionalOperationText(args.actorDisplayName, 'actor-display-name');
        if (args.resolution === 'duplicate_risk_accepted') {
            throw new Error('posting-resolution-requires-followup');
        }
        await requireGuildDocument(ctx, guildId);
        const operation = await ctx.db.get('dashboardPostingOperations', parseOperationId(args.operationId));
        if (operation?.guildId !== guildId) throw new Error('posting-operation-not-found');
        if (operation.status !== 'unknown') throw new Error('posting-resolution-status-invalid');
        if (operation.resolution) {
            if (operation.resolution !== args.resolution) throw new Error('posting-resolution-conflict');
            return toDashboardPostingOperationRecord(operation);
        }

        const now = new Date().toISOString();
        const patch = {
            resolution: args.resolution,
            resolvedAt: now,
            resolvedByUserId: actorUserId,
            updatedAt: now,
        };
        await ctx.db.patch('dashboardPostingOperations', operation._id, patch);
        await recordResolutionEvent(ctx, operation, {
            ...(actorDisplayName ? { actorDisplayName } : {}),
            actorUserId,
            ...(actorUsername ? { actorUsername } : {}),
            now,
            resolution: args.resolution,
        });
        return toDashboardPostingOperationRecord({ ...operation, ...patch });
    },
});

export const listDashboardPostingOperationsByGuild = query({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: dashboardPostingOperationListValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, webService);
        const guildId = normalizeBoundedOperationText(args.guildId, 'guild-id');
        const limit = Math.min(Math.max(Math.trunc(args.limit ?? 20), 1), 50);
        const operations = await ctx.db
            .query('dashboardPostingOperations')
            .withIndex('by_guild_updated', (candidate) => candidate.eq('guildId', guildId))
            .order('desc')
            .take(limit);
        return { operations: operations.map(toDashboardPostingOperationRecord) };
    },
});

export const readDashboardPostingOperationForBot = query({
    args: { operationId: v.string() },
    returns: v.union(dashboardPostingOperationRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await ctx.db.get('dashboardPostingOperations', parseOperationId(args.operationId));
        return operation ? toDashboardPostingOperationRecord(operation) : null;
    },
});

export const isDashboardPostingGuildRunnable = query({
    args: { guildId: v.string() },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        return isPostingGuildRunnable(ctx, args.guildId);
    },
});

export const pruneDashboardPostingOperations = internalMutation({
    args: {},
    returns: v.object({ deletedCount: v.number(), hasMore: v.boolean() }),
    handler: async (ctx) => {
        const now = new Date().toISOString();
        const candidates = (
            await Promise.all(
                terminalStatuses.map((status) =>
                    ctx.db
                        .query('dashboardPostingOperations')
                        .withIndex('by_status_expires', (candidate) =>
                            candidate.eq('status', status).gt('expiresAt', '').lte('expiresAt', now)
                        )
                        .take(pruneBatchSize + 1)
                )
            )
        ).flat();
        const expired = selectPrunableDashboardPostingOperations(candidates, now);
        const batch = expired.slice(0, pruneBatchSize);
        for (const operation of batch) await ctx.db.delete('dashboardPostingOperations', operation._id);

        const hasMore = expired.length > pruneBatchSize;
        if (hasMore) await ctx.scheduler.runAfter(0, internal.posting.pruneDashboardPostingOperations, {});
        return { deletedCount: batch.length, hasMore };
    },
});

export async function isPostingGuildRunnable(ctx: QueryCtx | MutationCtx, guildIdValue: string): Promise<boolean> {
    const guildId = guildIdValue.trim();
    const [config, installation] = await Promise.all([
        ctx.db.query('deploymentConfig').withIndex('by_config_id').unique(),
        ctx.db
            .query('botInstallations')
            .withIndex('by_guild_id', (candidate) => candidate.eq('guildId', guildId))
            .unique(),
    ]);
    if (!config || !installation) return false;
    return config.instanceMode !== 'single' || config.singleGuildId === guildId;
}

export function selectPrunableDashboardPostingOperations<
    T extends Pick<StoredDashboardPostingOperation, 'expiresAt' | 'status'>,
>(operations: T[], now: string): T[] {
    return operations
        .filter(
            (operation): operation is T & { expiresAt: string } =>
                isTerminalStatus(operation.status) &&
                typeof operation.expiresAt === 'string' &&
                operation.expiresAt <= now
        )
        .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt));
}

function isTerminalStatus(status: StoredDashboardPostingOperation['status']): boolean {
    return status === 'unknown' || status === 'sent' || status === 'permanent_failure';
}

function findByGuildRequest(ctx: MutationCtx, guildId: string, requestKey: string) {
    return ctx.db
        .query('dashboardPostingOperations')
        .withIndex('by_guild_request', (candidate) => candidate.eq('guildId', guildId).eq('requestKey', requestKey))
        .unique() as Promise<StoredDashboardPostingOperation | null>;
}

async function requireDuplicateRiskRetryTarget(ctx: MutationCtx, guildId: string, operationId: string) {
    const operation = await ctx.db.get('dashboardPostingOperations', parseOperationId(operationId));
    if (operation?.guildId !== guildId) throw new Error('posting-operation-not-found');
    if (operation.status !== 'unknown') throw new Error('posting-retry-status-invalid');
    if (operation.followupOperationId) throw new Error('posting-retry-already-created');
    if (operation.resolution && operation.resolution !== 'duplicate_risk_accepted') {
        throw new Error('posting-resolution-conflict');
    }
    return operation;
}

async function recordResolutionEvent(
    ctx: MutationCtx,
    operation: StoredDashboardPostingOperation,
    input: {
        actorDisplayName?: string;
        actorUserId: string;
        actorUsername?: string;
        followupOperationId?: string;
        now: string;
        resolution: NonNullable<StoredDashboardPostingOperation['resolution']>;
    }
) {
    await recordBotActionEventInMutation(ctx, {
        action: `message.delivery_${input.resolution}`,
        actorUserId: input.actorUserId,
        feature: 'posting',
        guildId: operation.guildId,
        metadata: {
            ...(input.actorDisplayName ? { actorDisplayName: input.actorDisplayName } : {}),
            ...(input.actorUsername ? { actorUsername: input.actorUsername } : {}),
            ...(input.followupOperationId ? { followupOperationId: input.followupOperationId } : {}),
            operationId: operation._id,
            resolution: input.resolution,
            resolvedAt: input.now,
            source: 'dashboard',
        },
        targetId: operation._id,
    });
}

function parseOperationId(id: string): GenericId<'dashboardPostingOperations'> {
    return normalizeBoundedOperationText(id, 'operation-id') as GenericId<'dashboardPostingOperations'>;
}
