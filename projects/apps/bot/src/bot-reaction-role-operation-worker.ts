import { randomUUID } from 'node:crypto';

import {
    acquireReactionRoleUserLease,
    blockReactionRoleReconciliationItem,
    claimNextReactionRoleOperation,
    completeReactionRoleDeleteOperation,
    completeReactionRolePublishOperation,
    completeReactionRoleReconciliationItem,
    completeReactionRoleSaveOperation,
    deferReactionRoleOperation,
    findReactionRoleMessageWithOptions,
    hasActiveReactionRoleMemberLease,
    hasOtherActiveReactionRoleAssignment,
    isReactionRoleGuildRunnable,
    listPendingReactionRoleReconciliationItems,
    markReactionRoleOperationNeedsAttention,
    markReactionRoleOperationSending,
    recordReactionRoleOperationExternalMessage,
    releaseReactionRoleUserLease,
    renewReactionRoleUserLease,
    snapshotReactionRoleOperationAssignments,
    type ReactionRoleOperationRecord,
    type ReactionRoleReconciliationItemRecord,
} from '@neonflux/db';
import { createFluxerPlatform, type FluxerPlatformError } from '@neonflux/fluxer';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { filterBotManageableRoleIds } from './bot-role-safety.js';

const operationLeaseTtlMs = 3 * 60_000;
const userLeaseTtlMs = 15 * 60_000;
const retryDelayMs = 5_000;
const maxRetryDelayMs = 5 * 60_000;
const maxAutomaticFailureCount = 8;
const reconciliationBatchSize = 10;

export type ReactionRoleOperationRunResult =
    | { status: 'idle' }
    | { status: 'progressed' | 'completed'; operationId: string }
    | { status: 'deferred' | 'needs_attention'; operationId: string; errorCode: string };

export async function runNextReactionRoleOperation(
    context: BotFeatureHandlerContext,
    input: { leaseOwner: string; now?: Date }
): Promise<ReactionRoleOperationRunResult> {
    const now = input.now ?? new Date();
    const leaseId = randomUUID();
    const claim = await claimNextReactionRoleOperation(context.db, {
        leaseExpiresAt: new Date(now.getTime() + operationLeaseTtlMs),
        leaseId,
        leaseOwner: input.leaseOwner,
        now,
    });
    if (claim.isErr()) return { status: 'deferred', operationId: 'unknown', errorCode: 'database_error' };
    if (!claim.value) return { status: 'idle' };
    const runnable = await isReactionRoleGuildRunnable(context.db, { guildId: claim.value.guildId });
    if (runnable.isErr()) return defer(context, claim.value, leaseId, now, 'database_error');
    if (!runnable.value) return attention(context, claim.value, leaseId, now, 'guild_out_of_scope');
    return processOperation(context, claim.value, leaseId, now);
}

async function processOperation(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleOperationRecord,
    leaseId: string,
    now: Date
): Promise<ReactionRoleOperationRunResult> {
    if (shouldPreflightDesiredRoles(operation)) {
        const roleIds = [...new Set(operation.desiredConfig.options.map((option) => option.roleId))];
        const manageable = await filterBotManageableRoleIds(context, { guildId: operation.guildId, roleIds });
        if (manageable.isErr()) return defer(context, operation, leaseId, now, 'role_preflight_failed');
        if (manageable.value.length !== roleIds.length) {
            return attention(context, operation, leaseId, now, 'role_hierarchy_blocked');
        }
    }
    if (operation.type !== 'publish' && !operation.snapshotComplete) {
        if (!operation.reactionRoleMessageId) return attention(context, operation, leaseId, now, 'message_missing');
        const activeLease = await hasActiveReactionRoleMemberLease(context.db, {
            messageId: operation.reactionRoleMessageId,
            now,
        });
        if (activeLease.isErr() || activeLease.value) {
            return defer(
                context,
                operation,
                leaseId,
                now,
                activeLease.isErr() ? 'database_error' : 'member_transition_active'
            );
        }
        const snapshot = await snapshotReactionRoleOperationAssignments(context.db, {
            cursor: operation.snapshotCursor,
            leaseId,
            limit: reconciliationBatchSize,
            now,
            operationId: operation.id,
        });
        if (snapshot.isErr()) return defer(context, operation, leaseId, now, 'database_error');
        return defer(
            context,
            operation,
            leaseId,
            now,
            snapshot.value.done ? 'snapshot_complete' : 'snapshot_progress',
            0
        );
    }

    if (operation.stage === 'reconcile') {
        return processReconciliationItems(context, operation, leaseId, now);
    }

    return operation.type === 'publish'
        ? processPublish(context, operation, leaseId, now)
        : operation.type === 'save'
          ? processSave(context, operation, leaseId, now)
          : processDelete(context, operation, leaseId, now);
}

function shouldPreflightDesiredRoles(operation: ReactionRoleOperationRecord) {
    if (operation.type === 'delete') return false;
    if (operation.type === 'publish') return operation.stage === 'send';
    return (
        operation.stage === 'message' ||
        (!operation.snapshotComplete && operation.snapshotCursor === null && operation.totalCount === 0)
    );
}

async function processReconciliationItems(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleOperationRecord,
    leaseId: string,
    now: Date
): Promise<ReactionRoleOperationRunResult> {
    const items = await listPendingReactionRoleReconciliationItems(context.db, {
        limit: reconciliationBatchSize,
        operationId: operation.id,
    });
    if (items.isErr()) return defer(context, operation, leaseId, now, 'database_error');
    for (const item of items.value) {
        const result = await reconcileItem(context, operation, item, leaseId, now);
        if (result) return result;
    }
    return defer(context, operation, leaseId, now, 'reconciliation_progress', 0);
}

async function reconcileItem(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleOperationRecord,
    item: ReactionRoleReconciliationItemRecord,
    leaseId: string,
    now: Date
): Promise<ReactionRoleOperationRunResult | null> {
    const userLeaseId = `${leaseId}:${item.id}`;
    const leaseOwner = operation.leaseOwner ?? 'reaction-role-operation-worker';
    const userLease = await acquireReactionRoleUserLease(context.db, {
        guildId: operation.guildId,
        leaseExpiresAt: new Date(now.getTime() + userLeaseTtlMs),
        leaseId: userLeaseId,
        leaseOwner,
        now,
        userId: item.userId,
    });
    if (userLease.isErr() || !userLease.value) {
        return defer(context, operation, leaseId, now, 'user_transition_active');
    }
    try {
        return await reconcileLockedItem(context, operation, item, leaseId, userLeaseId, leaseOwner, now);
    } finally {
        await releaseReactionRoleUserLease(context.db, {
            guildId: operation.guildId,
            leaseId: userLeaseId,
            userId: item.userId,
        });
    }
}

async function reconcileLockedItem(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleOperationRecord,
    item: ReactionRoleReconciliationItemRecord,
    leaseId: string,
    userLeaseId: string,
    leaseOwner: string,
    now: Date
): Promise<ReactionRoleOperationRunResult | null> {
    const scopeFailure = await ensureOperationScope(context, operation, leaseId, now);
    if (scopeFailure) return scopeFailure;
    const platform = createFluxerPlatform(context.client);
    const member = await platform.members.read({ guildId: operation.guildId, userId: item.userId });
    if (member.isErr() && member.error.type !== 'not-found') {
        return handlePlatformFailure(context, operation, leaseId, now, member.error, 'member_read_failed');
    }
    if (member.isOk() && member.value.roleIds.includes(item.roleId)) {
        const otherOwner = await hasOtherActiveReactionRoleAssignment(context.db, {
            assignmentId: item.assignmentId,
            guildId: operation.guildId,
            roleId: item.roleId,
            userId: item.userId,
        });
        if (otherOwner.isErr()) return defer(context, operation, leaseId, now, 'database_error');
        if (!otherOwner.value) {
            const manageable = await filterBotManageableRoleIds(context, {
                guildId: operation.guildId,
                roleIds: [item.roleId],
            });
            if (manageable.isErr()) return defer(context, operation, leaseId, now, 'role_preflight_failed');
            if (!manageable.value.includes(item.roleId)) {
                await blockReactionRoleReconciliationItem(context.db, {
                    errorCode: 'role_hierarchy_blocked',
                    itemId: item.id,
                    leaseId,
                    now,
                    operationId: operation.id,
                });
                return { status: 'needs_attention', operationId: operation.id, errorCode: 'role_hierarchy_blocked' };
            }
            if (!(await renewUserLease(context, operation, item, userLeaseId, leaseOwner))) {
                return defer(context, operation, leaseId, now, 'user_lease_lost');
            }
            const removed = await platform.members.removeRole({
                guildId: operation.guildId,
                roleId: item.roleId,
                userId: item.userId,
            });
            if (removed.isErr() && removed.error.type !== 'not-found') {
                return handlePlatformFailure(context, operation, leaseId, now, removed.error, 'role_remove_failed');
            }
        }
    }
    if (operation.externalMessageId && !operation.idempotencyKey.startsWith('gateway-message-deleted:')) {
        if (!(await renewUserLease(context, operation, item, userLeaseId, leaseOwner))) {
            return defer(context, operation, leaseId, now, 'user_lease_lost');
        }
        const reaction = await platform.messages.removeReaction({
            channelId: operation.channelId,
            emoji: item.emojiKey,
            messageId: operation.externalMessageId,
            userId: item.userId,
        });
        if (reaction.isErr() && reaction.error.type !== 'not-found') {
            return handlePlatformFailure(context, operation, leaseId, now, reaction.error, 'reaction_remove_failed');
        }
    }
    if (!(await renewUserLease(context, operation, item, userLeaseId, leaseOwner))) {
        return defer(context, operation, leaseId, now, 'user_lease_lost');
    }
    const completed = await completeReactionRoleReconciliationItem(context.db, {
        itemId: item.id,
        leaseId,
        now,
        operationId: operation.id,
        outcome: member.isErr() ? 'member_missing' : 'removed',
    });
    return completed.isErr() || !completed.value ? defer(context, operation, leaseId, now, 'database_error') : null;
}

async function renewUserLease(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleOperationRecord,
    item: ReactionRoleReconciliationItemRecord,
    leaseId: string,
    leaseOwner: string
) {
    const runnable = await isReactionRoleGuildRunnable(context.db, { guildId: operation.guildId });
    if (runnable.isErr() || !runnable.value) return false;
    const leaseNow = new Date();
    const renewed = await renewReactionRoleUserLease(context.db, {
        guildId: operation.guildId,
        leaseExpiresAt: new Date(leaseNow.getTime() + userLeaseTtlMs),
        leaseId,
        leaseOwner,
        now: leaseNow,
        userId: item.userId,
    });
    return renewed.isOk() && renewed.value;
}

async function processPublish(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleOperationRecord,
    leaseId: string,
    now: Date
): Promise<ReactionRoleOperationRunResult> {
    const platform = createFluxerPlatform(context.client);
    let current = operation;
    if (!current.externalMessageId) {
        const scopeFailure = await ensureOperationScope(context, current, leaseId, now);
        if (scopeFailure) return scopeFailure;
        const sending = await markReactionRoleOperationSending(context.db, { leaseId, now, operationId: current.id });
        if (sending.isErr() || !sending.value) return defer(context, current, leaseId, now, 'database_error');
        current = sending.value;
        const sent = await platform.messages.send({
            allowedMentions: { parse: [] },
            channelId: current.channelId,
            ...(current.desiredConfig.messageContent ? { content: current.desiredConfig.messageContent } : {}),
            ...(current.desiredConfig.messageEmbeds.length > 0
                ? {
                      embeds: current.desiredConfig.messageEmbeds as Parameters<
                          typeof platform.messages.send
                      >[0]['embeds'],
                  }
                : {}),
        });
        if (sent.isErr()) {
            return attention(context, current, leaseId, now, 'unknown_publish_outcome');
        }
        const recorded = await recordReactionRoleOperationExternalMessage(context.db, {
            channelId: sent.value.channelId,
            externalMessageId: sent.value.id,
            leaseId,
            now,
            operationId: current.id,
        });
        if (recorded.isErr() || !recorded.value)
            return { status: 'deferred', operationId: current.id, errorCode: 'database_error' };
        current = recorded.value;
    }
    const seeded = await seedReactions(context, current, leaseId, now);
    if (seeded) return seeded;
    const completed = await completeReactionRolePublishOperation(context.db, { leaseId, now, operationId: current.id });
    return completed.isOk() && completed.value
        ? { status: 'completed', operationId: current.id }
        : defer(context, current, leaseId, now, 'database_error');
}

async function processSave(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleOperationRecord,
    leaseId: string,
    now: Date
): Promise<ReactionRoleOperationRunResult> {
    if (!operation.externalMessageId) return attention(context, operation, leaseId, now, 'message_missing');
    const scopeFailure = await ensureOperationScope(context, operation, leaseId, now);
    if (scopeFailure) return scopeFailure;
    const platform = createFluxerPlatform(context.client);
    const current = await findReactionRoleMessageWithOptions(context.db, {
        guildId: operation.guildId,
        messageId: operation.externalMessageId,
    });
    if (current.isErr()) return defer(context, operation, leaseId, now, 'database_error');
    const edited = await platform.messages.edit({
        allowedMentions: { parse: [] },
        channelId: operation.channelId,
        content: operation.desiredConfig.messageContent ?? '',
        embeds: operation.desiredConfig.messageEmbeds as Parameters<typeof platform.messages.edit>[0]['embeds'],
        messageId: operation.externalMessageId,
    });
    if (edited.isErr())
        return handlePlatformFailure(context, operation, leaseId, now, edited.error, 'message_edit_failed');
    const seeded = await seedReactions(context, operation, leaseId, now);
    if (seeded) return seeded;
    const desiredEmojiKeys = new Set(operation.desiredConfig.options.map((option) => option.emojiKey));
    for (const option of current.value.options) {
        if (desiredEmojiKeys.has(option.emojiKey)) continue;
        const cleanupScopeFailure = await ensureOperationScope(context, operation, leaseId, now);
        if (cleanupScopeFailure) return cleanupScopeFailure;
        const removed = await platform.messages.removeReactionEmoji({
            channelId: operation.channelId,
            emoji: option.emojiKey,
            messageId: operation.externalMessageId,
        });
        if (removed.isErr() && removed.error.type !== 'not-found') {
            return handlePlatformFailure(context, operation, leaseId, now, removed.error, 'reaction_cleanup_failed');
        }
    }
    const completed = await completeReactionRoleSaveOperation(context.db, { leaseId, now, operationId: operation.id });
    return completed.isOk() && completed.value
        ? { status: 'completed', operationId: operation.id }
        : defer(context, operation, leaseId, now, 'database_error');
}

async function processDelete(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleOperationRecord,
    leaseId: string,
    now: Date
): Promise<ReactionRoleOperationRunResult> {
    if (operation.externalMessageId && !operation.idempotencyKey.startsWith('gateway-message-deleted:')) {
        const scopeFailure = await ensureOperationScope(context, operation, leaseId, now);
        if (scopeFailure) return scopeFailure;
        const deleted = await createFluxerPlatform(context.client).messages.delete({
            channelId: operation.channelId,
            messageId: operation.externalMessageId,
        });
        if (deleted.isErr() && deleted.error.type !== 'not-found') {
            return handlePlatformFailure(context, operation, leaseId, now, deleted.error, 'message_delete_failed');
        }
    }
    const completed = await completeReactionRoleDeleteOperation(context.db, {
        leaseId,
        now,
        operationId: operation.id,
    });
    if (completed.isErr()) return defer(context, operation, leaseId, now, 'database_error');
    return completed.value
        ? { status: 'completed', operationId: operation.id }
        : defer(context, operation, leaseId, now, 'cleanup_progress', 0);
}

async function seedReactions(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleOperationRecord,
    leaseId: string,
    now: Date
): Promise<ReactionRoleOperationRunResult | null> {
    if (!operation.externalMessageId) return attention(context, operation, leaseId, now, 'message_missing');
    const messages = createFluxerPlatform(context.client).messages;
    for (const option of operation.desiredConfig.options) {
        const scopeFailure = await ensureOperationScope(context, operation, leaseId, now);
        if (scopeFailure) return scopeFailure;
        const result = await messages.react({
            channelId: operation.channelId,
            emoji: option.emojiKey,
            messageId: operation.externalMessageId,
        });
        if (result.isErr())
            return handlePlatformFailure(context, operation, leaseId, now, result.error, 'reaction_seed_failed');
    }
    return null;
}

async function ensureOperationScope(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleOperationRecord,
    leaseId: string,
    now: Date
): Promise<ReactionRoleOperationRunResult | null> {
    const runnable = await isReactionRoleGuildRunnable(context.db, { guildId: operation.guildId });
    if (runnable.isErr()) return defer(context, operation, leaseId, now, 'database_error');
    return runnable.value ? null : attention(context, operation, leaseId, now, 'guild_out_of_scope');
}

async function handlePlatformFailure(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleOperationRecord,
    leaseId: string,
    now: Date,
    error: FluxerPlatformError,
    fallbackCode: string
) {
    if (error.type === 'not-found') return attention(context, operation, leaseId, now, 'external_not_found');
    return error.type === 'permission-denied' || error.type === 'unsupported' || error.type === 'invalid-value'
        ? attention(context, operation, leaseId, now, error.type)
        : defer(context, operation, leaseId, now, fallbackCode);
}

async function defer(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleOperationRecord,
    leaseId: string,
    now: Date,
    errorCode: string,
    delayMs?: number
): Promise<ReactionRoleOperationRunResult> {
    const progress = isProgressCode(errorCode);
    if (!progress && operation.failureCount >= maxAutomaticFailureCount - 1) {
        return attention(context, operation, leaseId, now, `${errorCode}_retry_exhausted`);
    }
    const retryNumber = Math.max(0, operation.failureCount);
    const resolvedDelayMs = delayMs ?? Math.min(retryDelayMs * 2 ** Math.min(retryNumber, 6), maxRetryDelayMs);
    await deferReactionRoleOperation(context.db, {
        errorCode,
        leaseId,
        nextAttemptAt: new Date(now.getTime() + resolvedDelayMs),
        now,
        operationId: operation.id,
    });
    return { status: 'deferred', operationId: operation.id, errorCode };
}

function isProgressCode(errorCode: string) {
    return (
        errorCode === 'member_transition_active' ||
        errorCode === 'reconciliation_progress' ||
        errorCode === 'snapshot_complete' ||
        errorCode === 'snapshot_progress' ||
        errorCode === 'user_lease_lost' ||
        errorCode === 'user_transition_active'
    );
}

async function attention(
    context: BotFeatureHandlerContext,
    operation: ReactionRoleOperationRecord,
    leaseId: string,
    now: Date,
    errorCode: string
): Promise<ReactionRoleOperationRunResult> {
    await markReactionRoleOperationNeedsAttention(context.db, { errorCode, leaseId, now, operationId: operation.id });
    return { status: 'needs_attention', operationId: operation.id, errorCode };
}
