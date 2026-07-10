import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { buildBotActionEventDocument, buildBotActionEventSortKey } from '../core/events_model.js';
import { mutation, type MutationCtx } from '../_generated/server.js';
import { toOperationRecord, type StoredReactionRoleOperation } from './reaction_role_operation_model.js';
import { operationRecordValidator } from './reaction_roles_validators.js';

const botService = ['bot'] as const;
const completionArgs = {
    leaseId: v.string(),
    now: v.string(),
    operationId: v.string(),
};
const completionResult = v.union(operationRecordValidator, v.null());

export const completeReactionRolePublishOperation = mutation({
    args: completionArgs,
    returns: completionResult,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId);
        if (!operation?.externalMessageId || operation.type !== 'publish') return null;

        const existing = await findMessage(ctx, operation.guildId, operation.externalMessageId);
        let messageId: GenericId<'reactionRoleMessages'>;
        if (existing) {
            messageId = existing._id;
            await replaceMessageConfiguration(ctx, messageId, operation, args.now);
        } else {
            messageId = await ctx.db.insert('reactionRoleMessages', {
                channelId: operation.channelId,
                createdAt: args.now,
                enabled: operation.desiredConfig.enabled,
                generateOverview: operation.desiredConfig.generateOverview,
                guildId: operation.guildId,
                kind: 'reaction_role',
                lifecycle: 'ready',
                ...(operation.desiredConfig.messageContent
                    ? { messageContent: operation.desiredConfig.messageContent }
                    : {}),
                messageEmbeds: operation.desiredConfig.messageEmbeds,
                messageId: operation.externalMessageId,
                mode: operation.desiredConfig.mode,
                revision: 1,
                source: 'dashboard',
                updatedAt: args.now,
            });
            await replaceOptions(ctx, messageId, operation, args.now);
        }

        const completed = await finishOperation(ctx, { ...operation, reactionRoleMessageId: messageId }, args.now);
        await recordCompletionAudit(ctx, completed, 'message.created', args.now);
        return toOperationRecord(completed);
    },
});

export const completeReactionRoleSaveOperation = mutation({
    args: completionArgs,
    returns: completionResult,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId);
        if (!operation?.reactionRoleMessageId || operation.type !== 'save') return null;
        if (operation.processedCount < operation.totalCount || !operation.snapshotComplete) return null;
        const message = await ctx.db.get('reactionRoleMessages', operation.reactionRoleMessageId);
        if (message?.pendingOperationId !== operation._id) return null;
        if ((message.revision ?? 1) !== operation.expectedRevision) return null;

        await replaceMessageConfiguration(ctx, message._id, operation, args.now);
        const completed = await finishOperation(ctx, operation, args.now);
        await recordCompletionAudit(ctx, completed, 'message.updated', args.now);
        return toOperationRecord(completed);
    },
});

export const completeReactionRoleDeleteOperation = mutation({
    args: completionArgs,
    returns: completionResult,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedOperation(ctx, args.operationId, args.leaseId);
        if (!operation?.reactionRoleMessageId || operation.type !== 'delete') return null;
        if (operation.processedCount < operation.totalCount || !operation.snapshotComplete) return null;
        const message = await ctx.db.get('reactionRoleMessages', operation.reactionRoleMessageId);
        if (message?.pendingOperationId !== operation._id) return null;

        await recordCompletionAudit(ctx, operation, 'message.deleted', args.now);
        const options = await ctx.db
            .query('reactionRoleOptions')
            .withIndex('by_message_position', (query) => query.eq('reactionRoleMessageId', message._id))
            .take(100);
        for (const option of options) await ctx.db.delete('reactionRoleOptions', option._id);
        const memberStates = await ctx.db
            .query('reactionRoleMemberStates')
            .withIndex('by_message_status', (query) => query.eq('reactionRoleMessageId', message._id))
            .take(500);
        for (const state of memberStates) await ctx.db.delete('reactionRoleMemberStates', state._id);
        const remainingAssignments = await ctx.db
            .query('reactionRoleAssignments')
            .withIndex('by_guild_message_user', (query) =>
                query.eq('guildId', operation.guildId).eq('messageId', message.messageId)
            )
            .take(500);
        for (const assignment of remainingAssignments) await ctx.db.delete('reactionRoleAssignments', assignment._id);
        await ctx.db.delete('reactionRoleMessages', message._id);
        const completed = await finishOperation(ctx, operation, args.now);
        return toOperationRecord(completed);
    },
});

async function replaceMessageConfiguration(
    ctx: MutationCtx,
    messageId: GenericId<'reactionRoleMessages'>,
    operation: StoredReactionRoleOperation,
    now: string
) {
    const message = await ctx.db.get('reactionRoleMessages', messageId);
    if (!message) return;
    await ctx.db.patch('reactionRoleMessages', messageId, {
        channelId: operation.channelId,
        enabled: operation.desiredConfig.enabled,
        generateOverview: operation.desiredConfig.generateOverview,
        lifecycle: 'ready',
        messageContent: operation.desiredConfig.messageContent,
        messageEmbeds: operation.desiredConfig.messageEmbeds,
        mode: operation.desiredConfig.mode,
        pendingOperationId: undefined,
        revision: (message.revision ?? 1) + (operation.type === 'publish' ? 0 : 1),
        updatedAt: now,
    });
    await replaceOptions(ctx, messageId, operation, now);
}

async function replaceOptions(
    ctx: MutationCtx,
    messageId: GenericId<'reactionRoleMessages'>,
    operation: StoredReactionRoleOperation,
    now: string
) {
    const current = await ctx.db
        .query('reactionRoleOptions')
        .withIndex('by_message_position', (query) => query.eq('reactionRoleMessageId', messageId))
        .take(100);
    const desiredByEmoji = new Map(operation.desiredConfig.options.map((option) => [option.emojiKey, option]));

    for (const option of current) {
        const desired = desiredByEmoji.get(option.emojiKey);
        if (!desired) {
            await ctx.db.delete('reactionRoleOptions', option._id);
            continue;
        }
        await ctx.db.patch('reactionRoleOptions', option._id, {
            position: desired.position,
            roleId: desired.roleId,
            updatedAt: now,
        });
        desiredByEmoji.delete(option.emojiKey);
    }

    for (const desired of desiredByEmoji.values()) {
        await ctx.db.insert('reactionRoleOptions', {
            createdAt: now,
            emojiKey: desired.emojiKey,
            position: desired.position,
            reactionRoleMessageId: messageId,
            roleId: desired.roleId,
            updatedAt: now,
        });
    }
}

async function finishOperation(ctx: MutationCtx, operation: StoredReactionRoleOperation, now: string) {
    const completed: StoredReactionRoleOperation = {
        ...operation,
        completedAt: now,
        errorCode: undefined,
        leaseExpiresAt: undefined,
        leaseId: undefined,
        leaseOwner: undefined,
        nextAttemptAt: undefined,
        status: 'succeeded',
        updatedAt: now,
    };
    await ctx.db.patch('reactionRoleOperations', operation._id, {
        completedAt: now,
        errorCode: undefined,
        leaseExpiresAt: undefined,
        leaseId: undefined,
        leaseOwner: undefined,
        nextAttemptAt: undefined,
        reactionRoleMessageId: completed.reactionRoleMessageId,
        status: 'succeeded',
        updatedAt: now,
    });
    await markDashboardLiveAreasChangedInMutation(ctx, { areas: ['reaction_roles'], guildId: operation.guildId, now });
    return completed;
}

async function recordCompletionAudit(
    ctx: MutationCtx,
    operation: StoredReactionRoleOperation,
    action: string,
    now: string
) {
    const result = buildBotActionEventDocument(
        {
            action,
            actorUserId: operation.actorUserId,
            feature: 'reaction_roles',
            guildId: operation.guildId,
            metadata: {
                channelId: operation.channelId,
                operationId: operation._id,
                operationType: operation.type,
                processedAssignmentCount: operation.processedCount,
                source: 'dashboard',
            },
            ...(operation.externalMessageId ? { targetId: operation.externalMessageId } : {}),
        },
        now
    );
    if (!result.ok) throw new Error(result.error);
    const id = await ctx.db.insert('botActionEvents', result.value);
    await ctx.db.patch('botActionEvents', id, { sortKey: buildBotActionEventSortKey({ createdAt: now, id }) });
}

async function requireLeasedOperation(ctx: MutationCtx, id: string, leaseId: string) {
    const operation = await ctx.db.get('reactionRoleOperations', id.trim() as GenericId<'reactionRoleOperations'>);
    return operation?.leaseId === leaseId.trim() ? (operation as StoredReactionRoleOperation) : null;
}

async function findMessage(ctx: MutationCtx, guildId: string, messageId: string) {
    return await ctx.db
        .query('reactionRoleMessages')
        .withIndex('by_guild_message', (query) => query.eq('guildId', guildId).eq('messageId', messageId))
        .unique();
}
