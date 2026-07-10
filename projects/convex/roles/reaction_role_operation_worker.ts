import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { mutation, query, type MutationCtx } from '../_generated/server.js';
import {
    finishAssignmentSnapshotPass,
    toOperationRecord,
    type StoredReactionRoleOperation,
} from './reaction_role_operation_model.js';
import { operationRecordValidator, reconciliationItemRecordValidator } from './reaction_roles_validators.js';
import { isGuildRunnable } from './reaction_role_scope.js';

const botService = ['bot'] as const;
const operationOrNullValidator = v.union(operationRecordValidator, v.null());
const progressCodes = new Set([
    'member_transition_active',
    'cleanup_progress',
    'reconciliation_progress',
    'snapshot_complete',
    'snapshot_progress',
    'user_lease_lost',
    'user_transition_active',
]);

export const claimNextReactionRoleOperation = mutation({
    args: {
        leaseExpiresAt: v.string(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
    },
    returns: operationOrNullValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const candidate = await findClaimCandidate(ctx, args.now);
        if (!candidate) return null;

        if (
            candidate.type === 'publish' &&
            candidate.stage === 'sending' &&
            candidate.sendStartedAt &&
            !candidate.externalMessageId
        ) {
            await markAttention(ctx, candidate, 'unknown_publish_outcome', args.now);
            return null;
        }

        await ctx.db.patch('reactionRoleOperations', candidate._id, {
            attemptCount: candidate.attemptCount + 1,
            errorCode: undefined,
            leaseExpiresAt: args.leaseExpiresAt,
            leaseId: args.leaseId.trim(),
            leaseOwner: args.leaseOwner.trim(),
            nextAttemptAt: undefined,
            status: 'running',
            updatedAt: args.now,
        });
        return toOperationRecord({
            ...candidate,
            attemptCount: candidate.attemptCount + 1,
            errorCode: undefined,
            leaseExpiresAt: args.leaseExpiresAt,
            leaseId: args.leaseId.trim(),
            leaseOwner: args.leaseOwner.trim(),
            nextAttemptAt: undefined,
            status: 'running',
            updatedAt: args.now,
        });
    },
});

export const markReactionRoleOperationSending = mutation({
    args: { operationId: v.string(), leaseId: v.string(), now: v.string() },
    returns: operationOrNullValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId);
        if (!operation) return null;
        await ctx.db.patch('reactionRoleOperations', operation._id, {
            sendStartedAt: operation.sendStartedAt ?? args.now,
            stage: 'sending',
            updatedAt: args.now,
        });
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: ['reaction_roles'],
            guildId: operation.guildId,
            now: args.now,
        });
        return toOperationRecord({
            ...operation,
            sendStartedAt: operation.sendStartedAt ?? args.now,
            stage: 'sending',
            updatedAt: args.now,
        });
    },
});

export const recordReactionRoleOperationExternalMessage = mutation({
    args: {
        channelId: v.string(),
        externalMessageId: v.string(),
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: operationOrNullValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId);
        if (!operation) return null;
        const externalMessageId = args.externalMessageId.trim();
        let message = await ctx.db
            .query('reactionRoleMessages')
            .withIndex('by_guild_message', (query) =>
                query.eq('guildId', operation.guildId).eq('messageId', externalMessageId)
            )
            .unique();
        if (!message && operation.type === 'publish') {
            const messageId = await ctx.db.insert('reactionRoleMessages', {
                channelId: args.channelId.trim(),
                createdAt: args.now,
                enabled: operation.desiredConfig.enabled,
                generateOverview: operation.desiredConfig.generateOverview,
                guildId: operation.guildId,
                kind: 'reaction_role',
                lifecycle: 'syncing',
                ...(operation.desiredConfig.messageContent
                    ? { messageContent: operation.desiredConfig.messageContent }
                    : {}),
                messageEmbeds: operation.desiredConfig.messageEmbeds,
                messageId: externalMessageId,
                mode: operation.desiredConfig.mode,
                pendingOperationId: operation._id,
                revision: 1,
                source: 'dashboard',
                updatedAt: args.now,
            });
            for (const option of operation.desiredConfig.options) {
                await ctx.db.insert('reactionRoleOptions', {
                    createdAt: args.now,
                    emojiKey: option.emojiKey,
                    position: option.position,
                    reactionRoleMessageId: messageId,
                    roleId: option.roleId,
                    updatedAt: args.now,
                });
            }
            message = await ctx.db.get('reactionRoleMessages', messageId);
        }
        const patch = {
            channelId: args.channelId.trim(),
            externalMessageId,
            ...(message ? { reactionRoleMessageId: message._id } : {}),
            stage: 'reactions',
            updatedAt: args.now,
        };
        await ctx.db.patch('reactionRoleOperations', operation._id, patch);
        return toOperationRecord({ ...operation, ...patch });
    },
});

export const snapshotReactionRoleOperationAssignments = mutation({
    args: {
        cursor: v.union(v.string(), v.null()),
        leaseId: v.string(),
        limit: v.number(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: v.object({ createdCount: v.number(), cursor: v.union(v.string(), v.null()), done: v.boolean() }),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId);
        if (!operation?.externalMessageId || operation.type === 'publish') {
            return { createdCount: 0, cursor: null, done: true };
        }
        const externalMessageId = operation.externalMessageId;

        const page = await ctx.db
            .query('reactionRoleAssignments')
            .withIndex('by_guild_message_user', (query) =>
                query.eq('guildId', operation.guildId).eq('messageId', externalMessageId)
            )
            .paginate({ cursor: args.cursor, numItems: Math.min(Math.max(Math.trunc(args.limit), 1), 100) });
        const message = operation.reactionRoleMessageId
            ? await ctx.db.get('reactionRoleMessages', operation.reactionRoleMessageId)
            : null;
        const modeChanged =
            operation.type === 'save' &&
            message !== null &&
            (message.mode === 'exclusive' ? 'exclusive' : 'normal') !== operation.desiredConfig.mode;
        let createdCount = 0;

        for (const assignment of page.page) {
            if (assignment.removedAt || !isAssignmentAffected(operation, assignment, modeChanged)) continue;
            const existing = await ctx.db
                .query('reactionRoleReconciliationItems')
                .withIndex('by_operation_assignment', (query) =>
                    query.eq('operationId', operation._id).eq('assignmentId', assignment._id)
                )
                .unique();
            if (existing) continue;
            await ctx.db.insert('reactionRoleReconciliationItems', {
                assignmentId: assignment._id,
                attemptCount: 0,
                createdAt: args.now,
                emojiKey: assignment.emojiKey,
                operationId: operation._id,
                roleId: assignment.roleId,
                status: 'pending',
                updatedAt: args.now,
                userId: assignment.userId,
            });
            createdCount += 1;
        }

        const totalCount = operation.totalCount + createdCount;
        const patch = page.isDone
            ? finishAssignmentSnapshotPass({
                  processedCount: operation.processedCount,
                  stage: operation.stage,
                  totalCount,
              })
            : { snapshotCursor: page.continueCursor };
        await ctx.db.patch('reactionRoleOperations', operation._id, {
            ...patch,
            totalCount,
            updatedAt: args.now,
        });
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: ['reaction_roles'],
            guildId: operation.guildId,
            now: args.now,
        });
        return { createdCount, cursor: page.isDone ? null : page.continueCursor, done: page.isDone };
    },
});

export const listPendingReactionRoleReconciliationItems = query({
    args: { limit: v.number(), operationId: v.string() },
    returns: v.array(reconciliationItemRecordValidator),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const items = await ctx.db
            .query('reactionRoleReconciliationItems')
            .withIndex('by_operation_status', (query) =>
                query.eq('operationId', parseOperationId(args.operationId)).eq('status', 'pending')
            )
            .take(Math.min(Math.max(Math.trunc(args.limit), 1), 100));
        return items.map(toItemRecord);
    },
});

export const completeReactionRoleReconciliationItem = mutation({
    args: {
        itemId: v.string(),
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
        outcome: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId);
        const item = await ctx.db.get('reactionRoleReconciliationItems', parseItemId(args.itemId));
        if (!operation || item?.operationId !== operation._id) return false;
        if (item.status === 'succeeded') return true;
        const assignment = await ctx.db.get('reactionRoleAssignments', item.assignmentId);
        if (assignment) {
            if (assignment.reactionRoleMessageId) {
                const state = await ctx.db
                    .query('reactionRoleMemberStates')
                    .withIndex('by_message_user', (query) =>
                        query
                            .eq(
                                'reactionRoleMessageId',
                                assignment.reactionRoleMessageId as NonNullable<typeof assignment.reactionRoleMessageId>
                            )
                            .eq('userId', assignment.userId)
                    )
                    .unique();
                if (state) {
                    const desiredEmojiKeys = state.desiredEmojiKeys.filter((key) => key !== assignment.emojiKey);
                    if (desiredEmojiKeys.length === 0) {
                        await ctx.db.delete('reactionRoleMemberStates', state._id);
                    } else {
                        await ctx.db.patch('reactionRoleMemberStates', state._id, {
                            desiredEmojiKeys,
                            revision: state.revision + 1,
                            status: 'pending',
                            updatedAt: args.now,
                        });
                    }
                }
            }
            await ctx.db.delete('reactionRoleAssignments', assignment._id);
        }
        await ctx.db.patch('reactionRoleReconciliationItems', item._id, {
            attemptCount: item.attemptCount + 1,
            errorCode: undefined,
            outcome: args.outcome.trim(),
            status: 'succeeded',
            updatedAt: args.now,
        });
        const processedCount = operation.processedCount + 1;
        await ctx.db.patch('reactionRoleOperations', operation._id, {
            processedCount,
            ...(processedCount >= operation.totalCount
                ? { snapshotComplete: false, snapshotCursor: undefined, stage: 'verify' }
                : {}),
            succeededCount: operation.succeededCount + 1,
            updatedAt: args.now,
        });
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: ['reaction_roles'],
            guildId: operation.guildId,
            now: args.now,
        });
        return true;
    },
});

export const blockReactionRoleReconciliationItem = mutation({
    args: {
        errorCode: v.string(),
        itemId: v.string(),
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId);
        const item = await ctx.db.get('reactionRoleReconciliationItems', parseItemId(args.itemId));
        if (!operation || item?.operationId !== operation._id) return false;
        await ctx.db.patch('reactionRoleReconciliationItems', item._id, {
            attemptCount: item.attemptCount + 1,
            errorCode: args.errorCode.trim(),
            status: 'blocked',
            updatedAt: args.now,
        });
        await markAttention(ctx, operation, args.errorCode, args.now);
        return true;
    },
});

export const deferReactionRoleOperation = mutation({
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
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId);
        if (!operation) return false;
        const failureCount = progressCodes.has(args.errorCode.trim()) ? 0 : (operation.failureCount ?? 0) + 1;
        await ctx.db.patch('reactionRoleOperations', operation._id, {
            errorCode: args.errorCode.trim(),
            failureCount,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            nextAttemptAt: args.nextAttemptAt,
            status: 'waiting_retry',
            updatedAt: args.now,
        });
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: ['reaction_roles'],
            guildId: operation.guildId,
            now: args.now,
        });
        return true;
    },
});

export const markReactionRoleOperationNeedsAttention = mutation({
    args: {
        errorCode: v.string(),
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId);
        if (!operation) return false;
        await markAttention(ctx, operation, args.errorCode, args.now);
        return true;
    },
});

async function findClaimCandidate(ctx: MutationCtx, now: string) {
    const queued = await ctx.db
        .query('reactionRoleOperations')
        .withIndex('by_status_updated', (query) => query.eq('status', 'queued'))
        .take(25);
    const waiting = await ctx.db
        .query('reactionRoleOperations')
        .withIndex('by_status_next_attempt', (query) => query.eq('status', 'waiting_retry').lte('nextAttemptAt', now))
        .take(25);
    const running = await ctx.db
        .query('reactionRoleOperations')
        .withIndex('by_status_lease_expiry', (query) => query.eq('status', 'running').lt('leaseExpiresAt', now))
        .take(25);
    const candidates = [...queued, ...waiting, ...running].sort(
        (left, right) => left.updatedAt.localeCompare(right.updatedAt) || left._creationTime - right._creationTime
    );
    for (const candidate of candidates) {
        const operation = candidate as StoredReactionRoleOperation;
        if (await isGuildRunnable(ctx, operation.guildId)) return operation;
        await markAttention(ctx, operation, 'guild_out_of_scope', now);
    }
    return null;
}

async function requireLeasedOperation(ctx: MutationCtx, id: string, leaseId: string) {
    const operation = await ctx.db.get('reactionRoleOperations', parseOperationId(id));
    return operation && 'leaseId' in operation && operation.leaseId === leaseId.trim()
        ? (operation as StoredReactionRoleOperation)
        : null;
}

function parseOperationId(value: string): GenericId<'reactionRoleOperations'> {
    return value.trim() as GenericId<'reactionRoleOperations'>;
}

function parseItemId(value: string): GenericId<'reactionRoleReconciliationItems'> {
    return value.trim() as GenericId<'reactionRoleReconciliationItems'>;
}

async function markAttention(ctx: MutationCtx, operation: StoredReactionRoleOperation, errorCode: string, now: string) {
    await ctx.db.patch('reactionRoleOperations', operation._id, {
        blockedCount: operation.blockedCount + 1,
        errorCode: errorCode.trim(),
        leaseExpiresAt: undefined,
        leaseId: undefined,
        leaseOwner: undefined,
        status: 'needs_attention',
        updatedAt: now,
    });
    if (operation.reactionRoleMessageId) {
        await ctx.db.patch('reactionRoleMessages', operation.reactionRoleMessageId, {
            lifecycle: 'needs_attention',
            updatedAt: now,
        });
    }
    await markDashboardLiveAreasChangedInMutation(ctx, {
        areas: ['reaction_roles'],
        guildId: operation.guildId,
        now,
    });
}

function isAssignmentAffected(
    operation: StoredReactionRoleOperation,
    assignment: { emojiKey: string; roleId: string },
    modeChanged: boolean
) {
    if (operation.type === 'delete' || modeChanged) return true;
    const desired = operation.desiredConfig.options.find((option) => option.emojiKey === assignment.emojiKey);
    return desired?.roleId !== assignment.roleId;
}

function toItemRecord(item: {
    _id: string;
    assignmentId: string;
    attemptCount: number;
    createdAt: string;
    emojiKey: string;
    errorCode?: string;
    operationId: string;
    outcome?: string;
    roleId: string;
    status: string;
    updatedAt: string;
    userId: string;
}) {
    const status: 'blocked' | 'pending' | 'succeeded' =
        item.status === 'blocked' || item.status === 'succeeded' ? item.status : 'pending';
    return {
        assignmentId: item.assignmentId,
        attemptCount: item.attemptCount,
        createdAt: item.createdAt,
        emojiKey: item.emojiKey,
        errorCode: item.errorCode ?? null,
        id: item._id,
        operationId: item.operationId,
        outcome: item.outcome ?? null,
        roleId: item.roleId,
        status,
        updatedAt: item.updatedAt,
        userId: item.userId,
    };
}
