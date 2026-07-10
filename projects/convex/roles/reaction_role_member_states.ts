import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import type { Doc } from '../_generated/dataModel.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
import {
    toReactionRoleAssignmentRecord,
    toReactionRoleMessageRecord,
    toReactionRoleOptionRecord,
} from './reaction_roles_model.js';
import {
    assignmentRecordValidator,
    memberStateRecordValidator,
    messageRecordValidator,
    optionRecordValidator,
} from './reaction_roles_validators.js';
import {
    assignmentMatchesDesiredOption,
    canAcceptReactionRoleTransition,
    shouldReopenReactionRoleFinalization,
    shouldUseDesiredConfigForTransition,
} from './reaction_role_member_state_model.js';

const botService = ['bot'] as const;
const transitionResultValidator = v.union(
    v.object({ type: v.literal('ignored') }),
    v.object({ type: v.literal('queued'), state: memberStateRecordValidator })
);
const reconciliationValidator = v.object({
    assignments: v.array(assignmentRecordValidator),
    message: messageRecordValidator,
    options: v.array(optionRecordValidator),
    state: memberStateRecordValidator,
});

export const requestReactionRoleMemberTransition = mutation({
    args: {
        emojiKey: v.string(),
        eventType: v.union(v.literal('added'), v.literal('removed')),
        guildId: v.string(),
        messageId: v.string(),
        userId: v.string(),
    },
    returns: transitionResultValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const message = await findMessage(ctx, args.guildId, args.messageId);
        if (!message?.enabled || message.staleAt) {
            return { type: 'ignored' as const };
        }
        const operation = message.pendingOperationId
            ? await ctx.db.get('reactionRoleOperations', message.pendingOperationId)
            : null;
        if (
            !canAcceptReactionRoleTransition({
                lifecycle: message.lifecycle,
                pendingOperationStage: operation?.stage ?? null,
            })
        ) {
            return { type: 'ignored' as const };
        }
        const emojiKey = args.emojiKey.trim();
        const storedOptions = await listOptions(ctx, message._id);
        const useDesiredConfig = shouldUseDesiredConfigForTransition({
            operationStage: operation?.stage ?? null,
            operationType: operation?.type ?? null,
        });
        const options = useDesiredConfig ? (operation?.desiredConfig.options ?? []) : storedOptions;
        const option = options.find((candidate) => candidate.emojiKey === emojiKey);
        if (!option) return { type: 'ignored' as const };
        const userId = args.userId.trim();
        const existingState = await findMemberState(ctx, message._id, userId);
        const assignments = await listAssignments(ctx, message.guildId, message.messageId, userId);
        const currentDesired = new Set(
            existingState?.desiredEmojiKeys ??
                assignments
                    .filter((assignment) => !assignment.removedAt && assignment.desiredState !== 'absent')
                    .map((assignment) => assignment.emojiKey)
        );

        if (args.eventType === 'added') {
            const mode = useDesiredConfig ? operation?.desiredConfig.mode : message.mode;
            if (mode === 'exclusive') currentDesired.clear();
            currentDesired.add(emojiKey);
        } else {
            currentDesired.delete(emojiKey);
        }

        if (!existingState && assignments.length === 0 && currentDesired.size === 0) {
            return { type: 'ignored' as const };
        }

        const now = new Date().toISOString();
        if (
            operation &&
            shouldReopenReactionRoleFinalization({
                lifecycle: message.lifecycle,
                pendingOperationStage: operation.stage,
            })
        ) {
            await ctx.db.patch('reactionRoleOperations', operation._id, {
                snapshotComplete: false,
                snapshotCursor: undefined,
                stage: 'verify',
                updatedAt: now,
            });
        }
        await writeAssignmentIntents(ctx, {
            assignments,
            desiredEmojiKeys: currentDesired,
            guildId: message.guildId,
            messageId: message.messageId,
            now,
            options,
            reactionRoleMessageId: message._id,
            userId,
        });
        const leaseActive =
            existingState?.status === 'running' && Date.parse(existingState.leaseExpiresAt ?? '') > Date.now();
        const next = {
            configRevision: message.revision ?? 1,
            desiredEmojiKeys: [...currentDesired],
            errorCode: undefined,
            leaseExpiresAt: leaseActive ? existingState.leaseExpiresAt : undefined,
            leaseId: leaseActive ? existingState.leaseId : undefined,
            leaseOwner: leaseActive ? existingState.leaseOwner : undefined,
            nextAttemptAt: undefined,
            revision: (existingState?.revision ?? 0) + 1,
            status: leaseActive ? ('running' as const) : ('pending' as const),
            updatedAt: now,
        };

        if (existingState) {
            await ctx.db.patch('reactionRoleMemberStates', existingState._id, next);
            return { type: 'queued' as const, state: toMemberStateRecord({ ...existingState, ...next }) };
        }
        const document = {
            ...next,
            createdAt: now,
            guildId: message.guildId,
            messageId: message.messageId,
            reactionRoleMessageId: message._id,
            userId,
        };
        const id = await ctx.db.insert('reactionRoleMemberStates', toMemberStateInsert(document));
        return { type: 'queued' as const, state: toMemberStateRecord({ ...document, _id: id }) };
    },
});

export const claimNextReactionRoleMemberState = mutation({
    args: { leaseExpiresAt: v.string(), leaseId: v.string(), leaseOwner: v.string(), now: v.string() },
    returns: v.union(memberStateRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const candidate = await findClaimCandidate(ctx, args.now);
        if (!candidate) return null;
        const message = await ctx.db.get('reactionRoleMessages', candidate.reactionRoleMessageId);
        if (!message) return null;
        const patch = {
            configRevision: message.revision ?? 1,
            errorCode: undefined,
            leaseExpiresAt: args.leaseExpiresAt,
            leaseId: args.leaseId.trim(),
            leaseOwner: args.leaseOwner.trim(),
            nextAttemptAt: undefined,
            status: 'running' as const,
            updatedAt: args.now,
        };
        await ctx.db.patch('reactionRoleMemberStates', candidate._id, patch);
        return toMemberStateRecord({ ...candidate, ...patch });
    },
});

export const loadReactionRoleMemberReconciliation = query({
    args: { stateId: v.string() },
    returns: v.union(reconciliationValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const state = await ctx.db.get('reactionRoleMemberStates', parseStateId(args.stateId));
        if (!state) return null;
        const message = await ctx.db.get('reactionRoleMessages', state.reactionRoleMessageId);
        if (!message) return null;
        const options = await listOptions(ctx, message._id);
        const assignments = await listAssignments(ctx, message.guildId, message.messageId, state.userId);
        return {
            assignments: assignments.map(toReactionRoleAssignmentRecord),
            message: toReactionRoleMessageRecord(message),
            options: options.map(toReactionRoleOptionRecord),
            state: toMemberStateRecord(state),
        };
    },
});

export const completeReactionRoleMemberState = mutation({
    args: {
        appliedEmojiKeys: v.array(v.string()),
        leaseId: v.string(),
        now: v.string(),
        revision: v.number(),
        stateId: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const state = await ctx.db.get('reactionRoleMemberStates', parseStateId(args.stateId));
        if (state?.leaseId !== args.leaseId.trim() || state.revision !== args.revision) return false;
        const assignments = await listAssignments(ctx, state.guildId, state.messageId, state.userId);
        const desired = new Set(args.appliedEmojiKeys.map((key) => key.trim()).filter(Boolean));
        for (const assignment of assignments) {
            if (!desired.has(assignment.emojiKey)) {
                await ctx.db.delete('reactionRoleAssignments', assignment._id);
                continue;
            }
            await ctx.db.patch('reactionRoleAssignments', assignment._id, {
                desiredState: 'present',
                removedAt: undefined,
                status: 'applied',
                updatedAt: args.now,
            });
        }
        if (desired.size === 0) {
            await ctx.db.delete('reactionRoleMemberStates', state._id);
        } else {
            await ctx.db.patch('reactionRoleMemberStates', state._id, {
                desiredEmojiKeys: [...desired],
                errorCode: undefined,
                leaseExpiresAt: undefined,
                leaseId: undefined,
                leaseOwner: undefined,
                nextAttemptAt: undefined,
                status: 'synced',
                updatedAt: args.now,
            });
        }
        return true;
    },
});

export const deferReactionRoleMemberState = mutation({
    args: {
        errorCode: v.string(),
        leaseId: v.string(),
        nextAttemptAt: v.string(),
        now: v.string(),
        stateId: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const state = await ctx.db.get('reactionRoleMemberStates', parseStateId(args.stateId));
        if (state?.leaseId !== args.leaseId.trim()) return false;
        await ctx.db.patch('reactionRoleMemberStates', state._id, {
            errorCode: args.errorCode.trim(),
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            nextAttemptAt: args.nextAttemptAt,
            status: 'waiting_retry',
            updatedAt: args.now,
        });
        return true;
    },
});

export const blockReactionRoleMemberState = mutation({
    args: { errorCode: v.string(), leaseId: v.string(), now: v.string(), stateId: v.string() },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const state = await ctx.db.get('reactionRoleMemberStates', parseStateId(args.stateId));
        if (state?.leaseId !== args.leaseId.trim()) return false;
        await ctx.db.patch('reactionRoleMemberStates', state._id, {
            errorCode: args.errorCode.trim(),
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            status: 'blocked',
            updatedAt: args.now,
        });
        return true;
    },
});

export const hasActiveReactionRoleMemberLease = query({
    args: { messageId: v.string(), now: v.string() },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const states = await ctx.db
            .query('reactionRoleMemberStates')
            .withIndex('by_message_status_lease_expiry', (query) =>
                query
                    .eq('reactionRoleMessageId', parseMessageId(args.messageId))
                    .eq('status', 'running')
                    .gt('leaseExpiresAt', args.now)
            )
            .first();
        return states !== null;
    },
});

async function writeAssignmentIntents(
    ctx: MutationCtx,
    input: {
        assignments: Awaited<ReturnType<typeof listAssignments>>;
        desiredEmojiKeys: Set<string>;
        guildId: string;
        messageId: string;
        now: string;
        options: Array<{ emojiKey: string; roleId: string }>;
        reactionRoleMessageId: GenericId<'reactionRoleMessages'>;
        userId: string;
    }
) {
    const optionsByEmoji = new Map(input.options.map((option) => [option.emojiKey, option]));
    for (const assignment of input.assignments) {
        const desired = assignmentMatchesDesiredOption(assignment, input.desiredEmojiKeys, optionsByEmoji);
        await ctx.db.patch('reactionRoleAssignments', assignment._id, {
            desiredState: desired ? 'present' : 'absent',
            reactionRoleMessageId: input.reactionRoleMessageId,
            status: 'pending',
            updatedAt: input.now,
        });
    }
    for (const emojiKey of input.desiredEmojiKeys) {
        const option = optionsByEmoji.get(emojiKey);
        if (!option) continue;
        const matchingAssignment = input.assignments.some(
            (assignment) => assignment.emojiKey === emojiKey && assignment.roleId === option.roleId
        );
        if (matchingAssignment) continue;
        await ctx.db.insert('reactionRoleAssignments', {
            assignedAt: input.now,
            desiredState: 'present',
            emojiKey,
            guildId: input.guildId,
            messageId: input.messageId,
            reactionRoleMessageId: input.reactionRoleMessageId,
            roleId: option.roleId,
            status: 'pending',
            updatedAt: input.now,
            userId: input.userId,
        });
    }
}

async function findClaimCandidate(ctx: MutationCtx, now: string) {
    const pending = await ctx.db
        .query('reactionRoleMemberStates')
        .withIndex('by_status_updated', (query) => query.eq('status', 'pending'))
        .take(25);
    const waiting = await ctx.db
        .query('reactionRoleMemberStates')
        .withIndex('by_status_next_attempt', (query) => query.eq('status', 'waiting_retry').lte('nextAttemptAt', now))
        .take(25);
    const expired = await ctx.db
        .query('reactionRoleMemberStates')
        .withIndex('by_status_lease_expiry', (query) => query.eq('status', 'running').lt('leaseExpiresAt', now))
        .take(25);
    const candidates = [...pending, ...waiting, ...expired].sort(
        (left, right) => left.updatedAt.localeCompare(right.updatedAt) || left._creationTime - right._creationTime
    );
    return await findReadyCandidate(ctx, candidates, now);
}

async function findReadyCandidate(ctx: MutationCtx, candidates: Array<Doc<'reactionRoleMemberStates'>>, now: string) {
    for (const candidate of candidates) {
        const message = await ctx.db.get('reactionRoleMessages', candidate.reactionRoleMessageId);
        if (!message) {
            const assignments = await listAssignments(ctx, candidate.guildId, candidate.messageId, candidate.userId);
            for (const assignment of assignments) {
                await ctx.db.delete('reactionRoleAssignments', assignment._id);
            }
            await ctx.db.delete('reactionRoleMemberStates', candidate._id);
            continue;
        }
        if (!message.enabled || message.staleAt) {
            await ctx.db.patch('reactionRoleMemberStates', candidate._id, {
                errorCode: 'menu_unavailable',
                leaseExpiresAt: undefined,
                leaseId: undefined,
                leaseOwner: undefined,
                nextAttemptAt: undefined,
                status: 'blocked',
                updatedAt: now,
            });
            continue;
        }
        if ((message.lifecycle ?? 'ready') !== 'ready') {
            await ctx.db.patch('reactionRoleMemberStates', candidate._id, {
                errorCode: 'menu_syncing',
                leaseExpiresAt: undefined,
                leaseId: undefined,
                leaseOwner: undefined,
                nextAttemptAt: new Date(Date.parse(now) + 5_000).toISOString(),
                status: 'waiting_retry',
                updatedAt: now,
            });
            continue;
        }
        return candidate;
    }
    return null;
}

async function findMessage(ctx: QueryCtx | MutationCtx, guildId: string, messageId: string) {
    return await ctx.db
        .query('reactionRoleMessages')
        .withIndex('by_guild_message', (query) => query.eq('guildId', guildId.trim()).eq('messageId', messageId.trim()))
        .unique();
}

async function findMemberState(ctx: MutationCtx, messageId: GenericId<'reactionRoleMessages'>, userId: string) {
    return await ctx.db
        .query('reactionRoleMemberStates')
        .withIndex('by_message_user', (query) => query.eq('reactionRoleMessageId', messageId).eq('userId', userId))
        .unique();
}

async function listOptions(ctx: QueryCtx | MutationCtx, messageId: GenericId<'reactionRoleMessages'>) {
    return await ctx.db
        .query('reactionRoleOptions')
        .withIndex('by_message_position', (query) => query.eq('reactionRoleMessageId', messageId))
        .take(30);
}

async function listAssignments(ctx: QueryCtx | MutationCtx, guildId: string, messageId: string, userId: string) {
    return await ctx.db
        .query('reactionRoleAssignments')
        .withIndex('by_guild_message_user', (query) =>
            query.eq('guildId', guildId).eq('messageId', messageId).eq('userId', userId)
        )
        .take(100);
}

function toMemberStateRecord(state: {
    _id: string;
    configRevision: number;
    createdAt: string;
    desiredEmojiKeys: string[];
    errorCode?: string | undefined;
    guildId: string;
    leaseExpiresAt?: string | undefined;
    leaseId?: string | undefined;
    leaseOwner?: string | undefined;
    messageId: string;
    nextAttemptAt?: string | undefined;
    reactionRoleMessageId: string;
    revision: number;
    status: string;
    updatedAt: string;
    userId: string;
}) {
    const status = ['pending', 'running', 'waiting_retry', 'blocked', 'synced'].includes(state.status)
        ? (state.status as 'blocked' | 'pending' | 'running' | 'synced' | 'waiting_retry')
        : ('pending' as const);
    return {
        configRevision: state.configRevision,
        createdAt: state.createdAt,
        desiredEmojiKeys: state.desiredEmojiKeys,
        errorCode: state.errorCode ?? null,
        guildId: state.guildId,
        id: state._id,
        leaseExpiresAt: state.leaseExpiresAt ?? null,
        leaseId: state.leaseId ?? null,
        leaseOwner: state.leaseOwner ?? null,
        messageId: state.messageId,
        nextAttemptAt: state.nextAttemptAt ?? null,
        reactionRoleMessageId: state.reactionRoleMessageId,
        revision: state.revision,
        status,
        updatedAt: state.updatedAt,
        userId: state.userId,
    };
}

function toMemberStateInsert(value: {
    configRevision: number;
    createdAt: string;
    desiredEmojiKeys: string[];
    errorCode?: string | undefined;
    guildId: string;
    leaseExpiresAt?: string | undefined;
    leaseId?: string | undefined;
    leaseOwner?: string | undefined;
    messageId: string;
    nextAttemptAt?: string | undefined;
    reactionRoleMessageId: GenericId<'reactionRoleMessages'>;
    revision: number;
    status: 'pending' | 'running';
    updatedAt: string;
    userId: string;
}) {
    return {
        configRevision: value.configRevision,
        createdAt: value.createdAt,
        desiredEmojiKeys: value.desiredEmojiKeys,
        ...(value.errorCode ? { errorCode: value.errorCode } : {}),
        guildId: value.guildId,
        ...(value.leaseExpiresAt ? { leaseExpiresAt: value.leaseExpiresAt } : {}),
        ...(value.leaseId ? { leaseId: value.leaseId } : {}),
        ...(value.leaseOwner ? { leaseOwner: value.leaseOwner } : {}),
        messageId: value.messageId,
        ...(value.nextAttemptAt ? { nextAttemptAt: value.nextAttemptAt } : {}),
        reactionRoleMessageId: value.reactionRoleMessageId,
        revision: value.revision,
        status: value.status,
        updatedAt: value.updatedAt,
        userId: value.userId,
    };
}

function parseStateId(value: string): GenericId<'reactionRoleMemberStates'> {
    return value.trim() as GenericId<'reactionRoleMemberStates'>;
}

function parseMessageId(value: string): GenericId<'reactionRoleMessages'> {
    return value.trim() as GenericId<'reactionRoleMessages'>;
}
