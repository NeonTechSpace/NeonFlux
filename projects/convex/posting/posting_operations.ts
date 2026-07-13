import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { internal } from '../_generated/api.js';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
import { requireGuildDocument } from './posting.js';
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
        actorDisplayName: v.optional(v.string()),
        actorUsername: v.optional(v.string()),
        actorUserId: v.string(),
        content: v.optional(v.string()),
        embeds: v.optional(v.array(v.any())),
        guildId: v.string(),
        payloadHash: v.string(),
        requestKey: v.string(),
        requestedChannelId: v.string(),
    },
    returns: dashboardPostingOperationEnqueueValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, webService);
        const guildId = normalizeBoundedOperationText(args.guildId, 'guild-id');
        const requestKey = normalizeBoundedOperationText(args.requestKey, 'request-key');
        const actorUserId = normalizeBoundedOperationText(args.actorUserId, 'actor-user-id');
        const payloadHash = normalizeBoundedOperationText(args.payloadHash, 'payload-hash');
        const requestedChannelId = normalizeBoundedOperationText(args.requestedChannelId, 'channel-id');
        const actorUsername = normalizeOptionalOperationText(args.actorUsername, 'actor-username');
        const actorDisplayName = normalizeOptionalOperationText(args.actorDisplayName, 'actor-display-name');
        const payload = normalizeDashboardPostingPayload(args);

        await requireGuildDocument(ctx, guildId);
        const existing = await findByGuildRequest(ctx, guildId, requestKey);
        if (existing) {
            if (
                existing.actorUserId !== actorUserId ||
                existing.payloadHash !== payloadHash ||
                existing.requestedChannelId !== requestedChannelId
            ) {
                throw new Error('posting-request-key-conflict');
            }
            return { created: false, operation: toDashboardPostingOperationRecord(existing) };
        }

        const now = new Date().toISOString();
        const id = await ctx.db.insert('dashboardPostingOperations', {
            ...(actorDisplayName ? { actorDisplayName } : {}),
            ...(actorUsername ? { actorUsername } : {}),
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
            status: 'queued',
            updatedAt: now,
        });
        const operation = await ctx.db.get('dashboardPostingOperations', id);
        if (!operation) throw new Error('posting-operation-insert-failed');
        return { created: true, operation: toDashboardPostingOperationRecord(operation) };
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

function parseOperationId(id: string): GenericId<'dashboardPostingOperations'> {
    return normalizeBoundedOperationText(id, 'operation-id') as GenericId<'dashboardPostingOperations'>;
}
