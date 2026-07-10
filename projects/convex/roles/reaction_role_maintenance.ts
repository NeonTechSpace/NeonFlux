import { v } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { mutation, type MutationCtx } from '../_generated/server.js';

const botService = ['bot'] as const;
const resultValidator = v.object({
    assignmentsBackfilled: v.number(),
    expiredUserLeasesDeleted: v.number(),
    hasMore: v.boolean(),
    messagesBackfilled: v.number(),
    operationsDeleted: v.number(),
    reconciliationItemsDeleted: v.number(),
    removedAssignmentsDeleted: v.number(),
});

export const maintainReactionRoleState = mutation({
    args: {
        assignmentLimit: v.optional(v.number()),
        historyItemLimit: v.optional(v.number()),
        messageLimit: v.optional(v.number()),
        now: v.string(),
        retentionBefore: v.string(),
    },
    returns: resultValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const messageLimit = normalizeLimit(args.messageLimit, 25);
        const assignmentLimit = normalizeLimit(args.assignmentLimit, 50);
        const historyItemLimit = normalizeLimit(args.historyItemLimit, 100);

        const messages = await ctx.db
            .query('reactionRoleMessages')
            .withIndex('by_revision', (query) => query.eq('revision', undefined))
            .take(messageLimit);
        for (const message of messages) {
            await ctx.db.patch('reactionRoleMessages', message._id, {
                lifecycle: message.lifecycle ?? 'ready',
                revision: 1,
                updatedAt: message.updatedAt || args.now,
            });
        }

        const assignments = await ctx.db
            .query('reactionRoleAssignments')
            .withIndex('by_status', (query) => query.eq('status', undefined))
            .take(assignmentLimit);
        for (const assignment of assignments) {
            const parent = await ctx.db
                .query('reactionRoleMessages')
                .withIndex('by_guild_message', (query) =>
                    query.eq('guildId', assignment.guildId).eq('messageId', assignment.messageId)
                )
                .first();
            await ctx.db.patch('reactionRoleAssignments', assignment._id, {
                desiredState: assignment.removedAt ? 'absent' : 'present',
                ...(parent ? { reactionRoleMessageId: parent._id } : {}),
                status: 'applied',
                updatedAt: assignment.removedAt ?? assignment.assignedAt,
            });
        }

        const removedAssignments = await ctx.db
            .query('reactionRoleAssignments')
            .withIndex('by_removed_at', (query) => query.gt('removedAt', '').lte('removedAt', args.retentionBefore))
            .take(assignmentLimit);
        for (const assignment of removedAssignments) {
            await ctx.db.delete('reactionRoleAssignments', assignment._id);
        }

        const historyResult = await pruneOperationHistory(ctx, args.retentionBefore, historyItemLimit);
        const expiredUserLeases = await ctx.db
            .query('reactionRoleUserLeases')
            .withIndex('by_expiry', (query) => query.lte('leaseExpiresAt', args.now))
            .take(assignmentLimit);
        for (const lease of expiredUserLeases) await ctx.db.delete('reactionRoleUserLeases', lease._id);
        return {
            assignmentsBackfilled: assignments.length,
            expiredUserLeasesDeleted: expiredUserLeases.length,
            hasMore:
                messages.length === messageLimit ||
                assignments.length === assignmentLimit ||
                removedAssignments.length === assignmentLimit ||
                expiredUserLeases.length === assignmentLimit ||
                historyResult.hasMore,
            messagesBackfilled: messages.length,
            operationsDeleted: historyResult.operationDeleted ? 1 : 0,
            reconciliationItemsDeleted: historyResult.itemsDeleted,
            removedAssignmentsDeleted: removedAssignments.length,
        };
    },
});

async function pruneOperationHistory(ctx: MutationCtx, retentionBefore: string, itemLimit: number) {
    const operation = await findPrunableOperation(ctx, retentionBefore);
    if (!operation) return { hasMore: false, itemsDeleted: 0, operationDeleted: false };

    const items = await ctx.db
        .query('reactionRoleReconciliationItems')
        .withIndex('by_operation_assignment', (query) => query.eq('operationId', operation._id))
        .take(itemLimit);
    for (const item of items) await ctx.db.delete('reactionRoleReconciliationItems', item._id);

    const remainingItem = await ctx.db
        .query('reactionRoleReconciliationItems')
        .withIndex('by_operation_assignment', (query) => query.eq('operationId', operation._id))
        .first();
    if (remainingItem) return { hasMore: true, itemsDeleted: items.length, operationDeleted: false };

    await ctx.db.delete('reactionRoleOperations', operation._id);
    return { hasMore: true, itemsDeleted: items.length, operationDeleted: true };
}

async function findPrunableOperation(ctx: MutationCtx, retentionBefore: string) {
    for (const status of ['succeeded', 'cancelled'] as const) {
        const candidates = await ctx.db
            .query('reactionRoleOperations')
            .withIndex('by_status_completed', (query) =>
                query.eq('status', status).gt('completedAt', '').lte('completedAt', retentionBefore)
            )
            .take(25);
        for (const candidate of candidates) {
            if (!candidate.completedAt || candidate.completedAt > retentionBefore) continue;
            if (!candidate.reactionRoleMessageId) return candidate;
            const message = await ctx.db.get('reactionRoleMessages', candidate.reactionRoleMessageId);
            if (message?.pendingOperationId !== candidate._id) return candidate;
        }
    }
    return null;
}

function normalizeLimit(value: number | undefined, fallback: number) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(100, Math.trunc(value ?? fallback)));
}
