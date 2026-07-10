import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
import {
    buildOperationDocument,
    toOperationInsert,
    toOperationRecord,
    type StoredReactionRoleOperation,
} from './reaction_role_operation_model.js';
import { desiredConfigValidator, operationRecordValidator } from './reaction_roles_validators.js';
import { isGuildRunnable } from './reaction_role_scope.js';

const webService = ['web'] as const;
const readableServices = ['bot', 'web'] as const;
const activeOperationStatuses = ['needs_attention', 'queued', 'running', 'waiting_retry'] as const;
const maxActiveOperationsPerGuild = 500;
const requestResultValidator = v.union(
    v.object({ type: v.literal('accepted'), operation: operationRecordValidator }),
    v.object({ type: v.literal('existing'), operation: operationRecordValidator }),
    v.object({ type: v.literal('busy'), operation: v.union(operationRecordValidator, v.null()) }),
    v.object({ type: v.literal('idempotency-conflict') }),
    v.object({ type: v.literal('not-found') }),
    v.object({ type: v.literal('revision-conflict'), currentRevision: v.number() })
);
const baseRequestArgs = {
    actorMetadata: v.optional(v.any()),
    actorUserId: v.string(),
    desiredConfig: desiredConfigValidator,
    guildId: v.string(),
    idempotencyKey: v.string(),
    requestHash: v.string(),
};

export const requestReactionRolePublishOperation = mutation({
    args: { ...baseRequestArgs, channelId: v.string() },
    returns: requestResultValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, webService);
        const existing = await findIdempotentOperation(ctx, args.guildId, args.idempotencyKey);
        const repeated = mapRepeatedOperation(existing, args.requestHash);
        if (repeated) return repeated;
        if ((await countActiveOperations(ctx, args.guildId)) >= maxActiveOperationsPerGuild) {
            return { type: 'busy' as const, operation: null };
        }

        const now = new Date().toISOString();
        const document = buildOperationDocument({ ...args, now, type: 'publish' });
        const id = await ctx.db.insert('reactionRoleOperations', toOperationInsert(document));
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: ['reaction_roles'],
            guildId: args.guildId,
            now,
        });
        return { type: 'accepted' as const, operation: toOperationRecord({ ...document, _id: id }) };
    },
});

export const requestReactionRoleSaveOperation = mutation({
    args: { ...baseRequestArgs, expectedRevision: v.number(), messageId: v.string() },
    returns: requestResultValidator,
    handler: async (ctx, args) => requestExistingMessageOperation(ctx, { ...args, type: 'save' }),
});

export const requestReactionRoleDeleteOperation = mutation({
    args: {
        actorMetadata: v.optional(v.any()),
        actorUserId: v.string(),
        expectedRevision: v.number(),
        guildId: v.string(),
        idempotencyKey: v.string(),
        messageId: v.string(),
        requestHash: v.string(),
    },
    returns: requestResultValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, webService);
        const existing = await findIdempotentOperation(ctx, args.guildId, args.idempotencyKey);
        const repeated = mapRepeatedOperation(existing, args.requestHash);
        if (repeated) return repeated;
        const message = await findMessage(ctx, args.guildId, args.messageId);
        if (!message) {
            return { type: 'not-found' as const };
        }

        const options = await ctx.db
            .query('reactionRoleOptions')
            .withIndex('by_message_position', (query) => query.eq('reactionRoleMessageId', message._id))
            .take(30);

        return requestExistingMessageOperation(ctx, {
            ...args,
            channelId: message.channelId,
            desiredConfig: {
                enabled: false,
                generateOverview: message.generateOverview,
                ...(message.messageContent ? { messageContent: message.messageContent } : {}),
                messageEmbeds: message.messageEmbeds,
                mode: message.mode === 'exclusive' ? 'exclusive' : 'normal',
                options: options.map((option) => ({
                    emojiKey: option.emojiKey,
                    position: option.position,
                    roleId: option.roleId,
                })),
            },
            type: 'delete',
        });
    },
});

export const requestReactionRoleExternalMessageDeleted = mutation({
    args: { guildId: v.string(), messageId: v.string() },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot'] as const);
        const guildId = args.guildId.trim();
        const externalMessageId = args.messageId.trim();
        if (!(await isGuildRunnable(ctx, guildId))) return false;
        const message = await findMessage(ctx, guildId, externalMessageId);
        if (!message) return false;

        const idempotencyKey = `gateway-message-deleted:${externalMessageId}`;
        if (await findIdempotentOperation(ctx, guildId, idempotencyKey)) return true;
        const now = new Date().toISOString();
        if (message.pendingOperationId) {
            const pending = await ctx.db.get('reactionRoleOperations', message.pendingOperationId);
            if (pending?.type === 'delete') return true;
            if (pending) {
                await ctx.db.patch('reactionRoleOperations', pending._id, {
                    completedAt: now,
                    errorCode: 'external_message_deleted',
                    leaseExpiresAt: undefined,
                    leaseId: undefined,
                    leaseOwner: undefined,
                    status: 'cancelled',
                    updatedAt: now,
                });
            }
        }
        const options = await ctx.db
            .query('reactionRoleOptions')
            .withIndex('by_message_position', (query) => query.eq('reactionRoleMessageId', message._id))
            .take(30);
        const document = buildOperationDocument({
            actorMetadata: { source: 'gateway_message_deleted' },
            actorUserId: 'system',
            channelId: message.channelId,
            desiredConfig: {
                enabled: false,
                generateOverview: message.generateOverview,
                ...(message.messageContent ? { messageContent: message.messageContent } : {}),
                messageEmbeds: message.messageEmbeds,
                mode: message.mode === 'exclusive' ? 'exclusive' : 'normal',
                options: options.map((option) => ({
                    emojiKey: option.emojiKey,
                    position: option.position,
                    roleId: option.roleId,
                })),
            },
            expectedRevision: message.revision ?? 1,
            externalMessageId,
            guildId,
            idempotencyKey,
            now,
            reactionRoleMessageId: message._id,
            requestHash: idempotencyKey,
            type: 'delete',
        });
        const operationId = await ctx.db.insert('reactionRoleOperations', toOperationInsert(document));
        await ctx.db.patch('reactionRoleMessages', message._id, {
            enabled: false,
            lifecycle: 'deleting',
            pendingOperationId: operationId,
            staleAt: now,
            updatedAt: now,
        });
        await markDashboardLiveAreasChangedInMutation(ctx, { areas: ['reaction_roles'], guildId, now });
        return true;
    },
});

export const listReactionRoleOperationsByGuildId = query({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(operationRecordValidator),
    handler: async (ctx: QueryCtx, args) => {
        await requireNeonFluxService(ctx, readableServices);
        const recent = await ctx.db
            .query('reactionRoleOperations')
            .withIndex('by_guild_created', (query) => query.eq('guildId', args.guildId.trim()))
            .order('desc')
            .take(Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 100));
        const operationsById = new Map(recent.map((operation) => [operation._id, operation]));
        for (const status of activeOperationStatuses) {
            const active = await ctx.db
                .query('reactionRoleOperations')
                .withIndex('by_guild_status_updated', (query) =>
                    query.eq('guildId', args.guildId.trim()).eq('status', status)
                )
                .take(500);
            for (const operation of active) operationsById.set(operation._id, operation);
        }
        return [...operationsById.values()]
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .map((operation) => toOperationRecord(operation as StoredReactionRoleOperation));
    },
});

export const retryReactionRoleOperation = mutation({
    args: { confirmUnknownPublishAbsent: v.boolean(), guildId: v.string(), operationId: v.string() },
    returns: v.union(
        v.object({ type: v.literal('queued'), operation: operationRecordValidator }),
        v.object({ type: v.literal('confirmation-required') }),
        v.object({ type: v.literal('not-found') })
    ),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, webService);
        const operation = await ctx.db.get(
            'reactionRoleOperations',
            args.operationId.trim() as GenericId<'reactionRoleOperations'>
        );
        if (operation?.guildId !== args.guildId.trim() || operation.status !== 'needs_attention') {
            return { type: 'not-found' as const };
        }
        if (operation.errorCode === 'unknown_publish_outcome' && !args.confirmUnknownPublishAbsent) {
            return { type: 'confirmation-required' as const };
        }
        const now = new Date().toISOString();
        const blockedItems = await ctx.db
            .query('reactionRoleReconciliationItems')
            .withIndex('by_operation_status', (query) => query.eq('operationId', operation._id).eq('status', 'blocked'))
            .take(100);
        for (const item of blockedItems) {
            await ctx.db.patch('reactionRoleReconciliationItems', item._id, {
                errorCode: undefined,
                status: 'pending',
                updatedAt: now,
            });
        }
        const resetUnknown = operation.errorCode === 'unknown_publish_outcome';
        const reverifySave = operation.type === 'save' && operation.stage === 'message';
        const patch = {
            blockedCount: 0,
            errorCode: undefined,
            failureCount: 0,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            nextAttemptAt: now,
            ...(resetUnknown ? { sendStartedAt: undefined, stage: 'send' } : {}),
            ...(reverifySave ? { snapshotComplete: false, snapshotCursor: undefined, stage: 'verify' } : {}),
            status: 'queued' as const,
            updatedAt: now,
        };
        await ctx.db.patch('reactionRoleOperations', operation._id, patch);
        if (operation.reactionRoleMessageId) {
            await ctx.db.patch('reactionRoleMessages', operation.reactionRoleMessageId, {
                lifecycle: operation.type === 'delete' ? 'deleting' : 'syncing',
                updatedAt: now,
            });
        }
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: ['reaction_roles'],
            guildId: operation.guildId,
            now,
        });
        return {
            type: 'queued' as const,
            operation: toOperationRecord({ ...(operation as StoredReactionRoleOperation), ...patch }),
        };
    },
});

async function requestExistingMessageOperation(
    ctx: MutationCtx,
    args: {
        actorMetadata?: unknown;
        actorUserId: string;
        channelId?: string;
        desiredConfig: Parameters<typeof buildOperationDocument>[0]['desiredConfig'];
        expectedRevision: number;
        guildId: string;
        idempotencyKey: string;
        messageId: string;
        requestHash: string;
        type: 'delete' | 'save';
    }
) {
    await requireNeonFluxService(ctx, webService);
    const existing = await findIdempotentOperation(ctx, args.guildId, args.idempotencyKey);
    const repeated = mapRepeatedOperation(existing, args.requestHash);
    if (repeated) return repeated;
    if ((await countActiveOperations(ctx, args.guildId)) >= maxActiveOperationsPerGuild) {
        return { type: 'busy' as const, operation: null };
    }

    const message = await findMessage(ctx, args.guildId, args.messageId);
    if (!message) return { type: 'not-found' as const };
    const revision = message.revision ?? 1;
    if (revision !== args.expectedRevision) return { type: 'revision-conflict' as const, currentRevision: revision };

    if (message.pendingOperationId || (message.lifecycle ?? 'ready') !== 'ready') {
        const pending = message.pendingOperationId
            ? await ctx.db.get('reactionRoleOperations', message.pendingOperationId)
            : null;
        return {
            type: 'busy' as const,
            operation: pending ? toOperationRecord(pending as StoredReactionRoleOperation) : null,
        };
    }

    const now = new Date().toISOString();
    const document = buildOperationDocument({
        ...args,
        channelId: args.channelId ?? message.channelId,
        externalMessageId: message.messageId,
        now,
        reactionRoleMessageId: message._id,
    });
    const id = await ctx.db.insert('reactionRoleOperations', toOperationInsert(document));
    await ctx.db.patch('reactionRoleMessages', message._id, {
        lifecycle: args.type === 'delete' ? 'deleting' : 'syncing',
        pendingOperationId: id,
        updatedAt: now,
    });
    await markDashboardLiveAreasChangedInMutation(ctx, {
        areas: ['reaction_roles'],
        guildId: message.guildId,
        now,
    });
    return { type: 'accepted' as const, operation: toOperationRecord({ ...document, _id: id }) };
}

async function findIdempotentOperation(ctx: MutationCtx, guildId: string, idempotencyKey: string) {
    return (await ctx.db
        .query('reactionRoleOperations')
        .withIndex('by_guild_idempotency', (query) =>
            query.eq('guildId', guildId.trim()).eq('idempotencyKey', idempotencyKey.trim())
        )
        .unique()) as StoredReactionRoleOperation | null;
}

function mapRepeatedOperation(existing: StoredReactionRoleOperation | null, requestHash: string) {
    if (!existing) return null;
    return existing.requestHash === requestHash.trim()
        ? { type: 'existing' as const, operation: toOperationRecord(existing) }
        : { type: 'idempotency-conflict' as const };
}

async function countActiveOperations(ctx: MutationCtx, guildId: string) {
    let count = 0;
    for (const status of activeOperationStatuses) {
        const remaining = maxActiveOperationsPerGuild - count;
        if (remaining <= 0) return count;
        count += (
            await ctx.db
                .query('reactionRoleOperations')
                .withIndex('by_guild_status_updated', (query) =>
                    query.eq('guildId', guildId.trim()).eq('status', status)
                )
                .take(remaining)
        ).length;
    }
    return count;
}

async function findMessage(ctx: MutationCtx, guildId: string, messageId: string) {
    return await ctx.db
        .query('reactionRoleMessages')
        .withIndex('by_guild_message', (query) => query.eq('guildId', guildId.trim()).eq('messageId', messageId.trim()))
        .unique();
}
