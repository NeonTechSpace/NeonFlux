import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
import { recordBotActionEventInMutation } from '../core/events.js';
import type { StoredReactionRolePanel, StoredReactionRoleSelectionSnapshot } from './reaction_role_model.js';
import { reactionRoleMemberWorkerRecordValidator } from './reaction_role_validators.js';

const botService = ['bot'] as const;
const maxClaimCandidates = 50;

type MemberOperation = {
    _id: GenericId<'reactionRoleMemberOperations'>;
    addedOptionIds: string[];
    attemptCount: number;
    baselineRoleIds?: string[];
    createdAt: string;
    desiredSelections: StoredReactionRoleSelectionSnapshot[];
    errorCode?: string;
    guildId: string;
    leaseExpiresAt?: string;
    leaseId?: string;
    leaseOwner?: string;
    nextAttemptAt?: string;
    panelId: GenericId<'reactionRolePanels'>;
    previousSelections: StoredReactionRoleSelectionSnapshot[];
    rerunRequested: boolean;
    revision: number;
    status: 'queued' | 'running' | 'completed' | 'permanent_failure';
    updatedAt: string;
    userId: string;
};

export const claimNextReactionRoleMemberOperation = mutation({
    args: {
        leaseExpiresAt: v.string(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
    },
    returns: v.union(reactionRoleMemberWorkerRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const nowMs = Date.parse(args.now);
        if (!Number.isFinite(nowMs) || Date.parse(args.leaseExpiresAt) <= nowMs) {
            throw new Error('reaction-role-member-lease-window-invalid');
        }
        const operation = (await findClaimCandidates(ctx, args.now))[0];
        if (!operation) return null;
        await ctx.db.patch('reactionRoleMemberOperations', operation._id, {
            attemptCount: operation.attemptCount + 1,
            errorCode: undefined,
            leaseExpiresAt: args.leaseExpiresAt,
            leaseId: args.leaseId,
            leaseOwner: args.leaseOwner,
            nextAttemptAt: undefined,
            rerunRequested: false,
            status: 'running',
            updatedAt: args.now,
        });
        const claimed = (await ctx.db.get('reactionRoleMemberOperations', operation._id)) as MemberOperation | null;
        return claimed ? await toWorkerRecord(ctx, claimed) : null;
    },
});

export const renewReactionRoleMemberOperationLease = mutation({
    args: {
        leaseExpiresAt: v.string(),
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const leaseExpiryMs = Date.parse(args.leaseExpiresAt);
        const nowMs = Date.parse(args.now);
        if (!Number.isFinite(leaseExpiryMs) || !Number.isFinite(nowMs) || leaseExpiryMs <= nowMs) {
            throw new Error('reaction-role-member-lease-window-invalid');
        }
        const operation = await requireLeasedMemberOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation) return false;
        await ctx.db.patch('reactionRoleMemberOperations', operation._id, {
            leaseExpiresAt: args.leaseExpiresAt,
            updatedAt: args.now,
        });
        return true;
    },
});

export const readReactionRoleMemberOperationForWorker = query({
    args: { operationId: v.string() },
    returns: v.union(reactionRoleMemberWorkerRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = (await ctx.db.get(
            'reactionRoleMemberOperations',
            args.operationId as GenericId<'reactionRoleMemberOperations'>
        )) as MemberOperation | null;
        return operation ? await toWorkerRecord(ctx, operation) : null;
    },
});

export const recordReactionRoleMemberBaseline = mutation({
    args: {
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
        roleIds: v.array(v.string()),
    },
    returns: v.union(reactionRoleMemberWorkerRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedMemberOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation) return null;
        if (!operation.baselineRoleIds) {
            await ctx.db.patch('reactionRoleMemberOperations', operation._id, {
                baselineRoleIds: [...new Set(args.roleIds.map((roleId) => roleId.trim()).filter(Boolean))],
                updatedAt: args.now,
            });
        }
        const updated = (await ctx.db.get('reactionRoleMemberOperations', operation._id)) as MemberOperation | null;
        return updated ? await toWorkerRecord(ctx, updated) : null;
    },
});

export const completeReactionRoleMemberOperation = mutation({
    args: {
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
        ownerships: v.array(
            v.object({
                grantOwnership: v.union(v.literal('panel'), v.literal('preexisting')),
                optionId: v.string(),
            })
        ),
        revision: v.number(),
    },
    returns: v.union(v.literal('completed'), v.literal('stale'), v.literal('missing')),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedMemberOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation) return 'missing' as const;
        if (operation.revision !== args.revision || operation.rerunRequested) {
            return 'stale' as const;
        }
        const ownershipByOption = new Map(args.ownerships.map((item) => [item.optionId, item.grantOwnership]));
        const selections = await ctx.db
            .query('reactionRoleSelections')
            .withIndex('by_panel_user', (queryBuilder) =>
                queryBuilder.eq('panelId', operation.panelId).eq('userId', operation.userId)
            )
            .collect();
        for (const selection of selections) {
            const ownership = ownershipByOption.get(selection.optionId);
            if (ownership) {
                await ctx.db.patch('reactionRoleSelections', selection._id, {
                    grantOwnership: ownership,
                    revision: selection.revision + 1,
                    updatedAt: args.now,
                });
            }
        }
        await ctx.db.patch('reactionRoleMemberOperations', operation._id, {
            baselineRoleIds: undefined,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            nextAttemptAt: undefined,
            status: 'completed',
            updatedAt: args.now,
        });
        return 'completed' as const;
    },
});

export const rollbackReactionRoleMemberOperation = mutation({
    args: {
        degradePanel: v.boolean(),
        errorCode: v.string(),
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
        revision: v.number(),
    },
    returns: v.union(v.literal('rolled-back'), v.literal('stale'), v.literal('missing')),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedMemberOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation) return 'missing' as const;
        if (operation.revision !== args.revision || operation.rerunRequested) {
            await requeue(ctx, operation, args.now);
            return 'stale' as const;
        }
        const current = await ctx.db
            .query('reactionRoleSelections')
            .withIndex('by_panel_user', (queryBuilder) =>
                queryBuilder.eq('panelId', operation.panelId).eq('userId', operation.userId)
            )
            .collect();
        for (const selection of current) await ctx.db.delete('reactionRoleSelections', selection._id);
        const panel = (await ctx.db.get('reactionRolePanels', operation.panelId)) as StoredReactionRolePanel | null;
        if (!panel) return 'missing' as const;
        for (const previous of operation.previousSelections) {
            await ctx.db.insert('reactionRoleSelections', {
                createdAt: args.now,
                emojiKey: emojiKey(previous.emoji),
                generation: panel.generation,
                grantOwnership: previous.grantOwnership,
                guildId: operation.guildId,
                optionId: previous.optionId,
                panelId: operation.panelId,
                revision: 1,
                roleId: previous.roleId,
                updatedAt: args.now,
                userId: operation.userId,
            });
        }
        await ctx.db.patch('reactionRoleMemberOperations', operation._id, {
            baselineRoleIds: undefined,
            errorCode: args.errorCode,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            nextAttemptAt: undefined,
            status: 'permanent_failure',
            updatedAt: args.now,
        });
        if (args.degradePanel) {
            await ctx.db.patch('reactionRolePanels', panel._id, {
                errorCode: args.errorCode,
                ...(panel.status === 'inactive' ? {} : { status: 'degraded' as const }),
                updatedAt: args.now,
            });
            await recordBotActionEventInMutation(ctx, {
                action: 'reaction_roles.panel.member_operation_failed',
                feature: 'reaction_roles',
                guildId: operation.guildId,
                metadata: {
                    errorCode: args.errorCode,
                    operationId: operation._id,
                },
                targetId: operation.panelId,
            });
        }
        return 'rolled-back' as const;
    },
});

export const deferReactionRoleMemberOperation = mutation({
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
        const operation = await requireLeasedMemberOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation) return false;
        if (Date.parse(args.nextAttemptAt) <= Date.parse(args.now)) {
            throw new Error('reaction-role-retry-window-invalid');
        }
        await ctx.db.patch('reactionRoleMemberOperations', operation._id, {
            errorCode: args.errorCode,
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

export const pauseReactionRoleMemberOperation = mutation({
    args: {
        leaseId: v.string(),
        nextAttemptAt: v.string(),
        now: v.string(),
        operationId: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedMemberOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation) return false;
        if (Date.parse(args.nextAttemptAt) <= Date.parse(args.now)) {
            throw new Error('reaction-role-retry-window-invalid');
        }
        await ctx.db.patch('reactionRoleMemberOperations', operation._id, {
            attemptCount: Math.max(0, operation.attemptCount - 1),
            errorCode: 'defcon_paused',
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

export const requeueStaleReactionRoleMemberOperation = mutation({
    args: {
        leaseId: v.string(),
        now: v.string(),
        operationId: v.string(),
        revision: v.number(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const operation = await requireLeasedMemberOperation(ctx, args.operationId, args.leaseId, args.now);
        if (!operation || (operation.revision === args.revision && !operation.rerunRequested)) return false;
        await requeue(ctx, operation, args.now);
        return true;
    },
});

async function requireLeasedMemberOperation(
    ctx: MutationCtx,
    operationId: string,
    leaseId: string,
    now: string
): Promise<MemberOperation | null> {
    const operation = (await ctx.db.get(
        'reactionRoleMemberOperations',
        operationId as GenericId<'reactionRoleMemberOperations'>
    )) as MemberOperation | null;
    if (
        operation?.status !== 'running' ||
        operation.leaseId !== leaseId ||
        !operation.leaseExpiresAt ||
        Date.parse(operation.leaseExpiresAt) <= Date.parse(now)
    ) {
        return null;
    }
    return operation;
}

async function requeue(ctx: MutationCtx, operation: MemberOperation, now: string): Promise<void> {
    await ctx.db.patch('reactionRoleMemberOperations', operation._id, {
        attemptCount: 0,
        baselineRoleIds: undefined,
        errorCode: undefined,
        leaseExpiresAt: undefined,
        leaseId: undefined,
        leaseOwner: undefined,
        nextAttemptAt: undefined,
        rerunRequested: false,
        status: 'queued',
        updatedAt: now,
    });
}

async function toWorkerRecord(ctx: QueryCtx | MutationCtx, operation: MemberOperation) {
    const panel = (await ctx.db.get('reactionRolePanels', operation.panelId)) as StoredReactionRolePanel | null;
    return {
        addedOptionIds: operation.addedOptionIds,
        attemptCount: operation.attemptCount,
        baselineRoleIds: operation.baselineRoleIds ?? null,
        channelId: panel?.channelId ?? '',
        createdAt: operation.createdAt,
        desiredSelections: operation.desiredSelections,
        errorCode: operation.errorCode ?? null,
        guildId: operation.guildId,
        id: operation._id,
        leaseExpiresAt: operation.leaseExpiresAt ?? null,
        leaseId: operation.leaseId ?? null,
        leaseOwner: operation.leaseOwner ?? null,
        messageId: panel?.messageId ?? null,
        nextAttemptAt: operation.nextAttemptAt ?? null,
        panelId: operation.panelId,
        previousSelections: operation.previousSelections,
        rerunRequested: operation.rerunRequested,
        revision: operation.revision,
        status: operation.status,
        updatedAt: operation.updatedAt,
        userId: operation.userId,
    };
}

async function findClaimCandidates(ctx: MutationCtx, now: string): Promise<MemberOperation[]> {
    const queued = (await ctx.db
        .query('reactionRoleMemberOperations')
        .withIndex('by_status_next_attempt', (queryBuilder) => queryBuilder.eq('status', 'queued'))
        .take(maxClaimCandidates)) as MemberOperation[];
    const expired = (await ctx.db
        .query('reactionRoleMemberOperations')
        .withIndex('by_status_lease_expiry', (queryBuilder) =>
            queryBuilder.eq('status', 'running').lt('leaseExpiresAt', now)
        )
        .take(maxClaimCandidates)) as MemberOperation[];
    return [
        ...queued.filter((operation) => !operation.nextAttemptAt || operation.nextAttemptAt <= now),
        ...expired,
    ].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
}

function emojiKey(emoji: StoredReactionRoleSelectionSnapshot['emoji']): string {
    return emoji.kind === 'custom' ? `custom:${emoji.id}` : `unicode:${emoji.value.normalize('NFC')}`;
}
