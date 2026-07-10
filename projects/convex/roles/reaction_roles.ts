import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    buildReactionRoleMessageDocument,
    buildReactionRoleOptionDocument,
    normalizeLimit,
    normalizeRequiredEmojiKey,
    normalizeRequiredGuildId,
    normalizeRequiredMessageId,
    normalizeRequiredReactionRoleMessageId,
    toReactionRoleMessageRecord,
    toReactionRoleOptionRecord,
    type ReactionRoleMessageDocument,
    type ReactionRoleOptionDocument,
} from './reaction_roles_model.js';
import {
    messageRecordValidator,
    messageWithOptionsValidator,
    optionMatchValidator,
    optionRecordValidator,
} from './reaction_roles_validators.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';

export {
    completeReactionRoleDeleteOperation,
    completeReactionRolePublishOperation,
    completeReactionRoleSaveOperation,
} from './reaction_role_operation_completion.js';
export {
    listReactionRoleOperationsByGuildId,
    requestReactionRoleDeleteOperation,
    requestReactionRolePublishOperation,
    retryReactionRoleOperation,
    requestReactionRoleSaveOperation,
} from './reaction_role_operation_requests.js';
export {
    blockReactionRoleReconciliationItem,
    claimNextReactionRoleOperation,
    completeReactionRoleReconciliationItem,
    deferReactionRoleOperation,
    listPendingReactionRoleReconciliationItems,
    markReactionRoleOperationNeedsAttention,
    markReactionRoleOperationSending,
    recordReactionRoleOperationExternalMessage,
    snapshotReactionRoleOperationAssignments,
} from './reaction_role_operation_worker.js';
export {
    listActiveReactionRoleAssignmentsByGuildMessageUser,
    listActiveReactionRoleAssignmentsByGuildUser,
    markReactionRoleAssignmentRemoved,
    markReactionRoleAssignmentsRemovedByMessageUser,
    upsertReactionRoleAssignment,
} from './reaction_role_assignments.js';
export {
    blockReactionRoleMemberState,
    claimNextReactionRoleMemberState,
    completeReactionRoleMemberState,
    deferReactionRoleMemberState,
    hasActiveReactionRoleMemberLease,
    loadReactionRoleMemberReconciliation,
    requestReactionRoleMemberTransition,
} from './reaction_role_member_states.js';
export { maintainReactionRoleState } from './reaction_role_maintenance.js';
export {
    acquireReactionRoleUserLease,
    hasOtherActiveReactionRoleAssignment,
    releaseReactionRoleUserLease,
    renewReactionRoleUserLease,
} from './reaction_role_user_leases.js';
type ReactionRolesQueryCtx = QueryCtx;
type ReactionRolesMutationCtx = MutationCtx;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredReactionRoleMessageDocument = ReactionRoleMessageDocument & { _id: GenericId<'reactionRoleMessages'> };
type StoredReactionRoleOptionDocument = ReactionRoleOptionDocument & { _id: GenericId<'reactionRoleOptions'> };
const readableReactionRoleServices = ['bot', 'web'] as const;
const disabledLegacyMutationServices = [] as const;

export const upsertReactionRoleMessage = mutation({
    args: {
        channelId: v.string(),
        createdAt: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        generateOverview: v.optional(v.boolean()),
        guildId: v.string(),
        messageContent: v.optional(v.union(v.string(), v.null())),
        messageEmbeds: v.optional(v.array(v.any())),
        messageId: v.string(),
        mode: v.optional(v.string()),
        source: v.optional(v.string()),
        staleAt: v.optional(v.union(v.string(), v.null())),
        updatedAt: v.optional(v.string()),
    },
    returns: messageRecordValidator,
    handler: async (ctx: ReactionRolesMutationCtx, args) => {
        await requireNeonFluxService(ctx, disabledLegacyMutationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);
        const existingMessage = await findReactionRoleMessageDocument(ctx, { guildId, messageId: args.messageId });
        const document = unwrap(
            buildReactionRoleMessageDocument(
                {
                    ...args,
                    guildId,
                },
                new Date().toISOString(),
                existingMessage ?? undefined
            )
        );

        if (existingMessage) {
            await ctx.db.patch('reactionRoleMessages', existingMessage._id, {
                channelId: document.channelId,
                enabled: document.enabled,
                generateOverview: document.generateOverview,
                messageContent: document.messageContent,
                messageEmbeds: document.messageEmbeds,
                mode: document.mode,
                source: document.source,
                staleAt: document.staleAt,
                updatedAt: document.updatedAt,
            });
            return toReactionRoleMessageRecord({ ...existingMessage, ...document });
        } else {
            const id = await ctx.db.insert('reactionRoleMessages', document);
            return toReactionRoleMessageRecord({ ...document, _id: id });
        }
    },
});

export const listReactionRoleMessagesByGuildId = query({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(messageWithOptionsValidator),
    handler: async (ctx: ReactionRolesQueryCtx, args) => {
        await requireNeonFluxService(ctx, readableReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messages = await ctx.db
            .query('reactionRoleMessages')
            .withIndex('by_guild_channel_message', (query) => query.eq('guildId', guildId))
            .order('asc')
            .take(normalizeLimit(args.limit));

        return await Promise.all(
            messages.map(async (message) => ({
                ...toReactionRoleMessageRecord(message),
                options: (await listOptionsByMessageId(ctx, message._id)).map(toReactionRoleOptionRecord),
            }))
        );
    },
});

export const findReactionRoleMessage = query({
    args: { guildId: v.string(), messageId: v.string() },
    returns: v.union(messageRecordValidator, v.null()),
    handler: async (ctx: ReactionRolesQueryCtx, args) => {
        await requireNeonFluxService(ctx, readableReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const message = await findReactionRoleMessageDocument(ctx, { guildId, messageId });

        return message ? toReactionRoleMessageRecord(message) : null;
    },
});

export const findReactionRoleMessageWithOptions = query({
    args: { guildId: v.string(), messageId: v.string() },
    returns: v.union(messageWithOptionsValidator, v.null()),
    handler: async (ctx: ReactionRolesQueryCtx, args) => {
        await requireNeonFluxService(ctx, readableReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const message = await findReactionRoleMessageDocument(ctx, { guildId, messageId });
        if (!message) return null;
        return {
            ...toReactionRoleMessageRecord(message),
            options: (await listOptionsByMessageId(ctx, message._id)).map(toReactionRoleOptionRecord),
        };
    },
});

export const findEnabledReactionRoleOptionByReaction = query({
    args: { emojiKey: v.string(), guildId: v.string(), messageId: v.string() },
    returns: v.union(optionMatchValidator, v.null()),
    handler: async (ctx: ReactionRolesQueryCtx, args) => {
        await requireNeonFluxService(ctx, readableReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const emojiKey = unwrap(normalizeRequiredEmojiKey(args.emojiKey));
        const message = await findReactionRoleMessageDocument(ctx, { guildId, messageId });

        if (!message?.enabled || message.staleAt || (message.lifecycle ?? 'ready') !== 'ready') return null;

        const option = await findReactionRoleOptionDocument(ctx, {
            emojiKey,
            reactionRoleMessageId: message._id,
        });

        return option
            ? {
                  message: toReactionRoleMessageRecord(message),
                  option: toReactionRoleOptionRecord(option),
              }
            : null;
    },
});

export const deleteReactionRoleMessage = mutation({
    args: { guildId: v.string(), messageId: v.string() },
    returns: v.union(messageRecordValidator, v.null()),
    handler: async (ctx: ReactionRolesMutationCtx, args) => {
        await requireNeonFluxService(ctx, disabledLegacyMutationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const message = await findReactionRoleMessageDocument(ctx, { guildId, messageId });

        if (!message) return null;

        const options = await listOptionsByMessageId(ctx, message._id);

        for (const option of options) {
            await ctx.db.delete('reactionRoleOptions', option._id);
        }

        await ctx.db.delete('reactionRoleMessages', message._id);

        return toReactionRoleMessageRecord(message);
    },
});

export const upsertReactionRoleOption = mutation({
    args: {
        createdAt: v.optional(v.string()),
        emojiKey: v.string(),
        position: v.optional(v.number()),
        reactionRoleMessageId: v.string(),
        roleId: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: optionRecordValidator,
    handler: async (ctx: ReactionRolesMutationCtx, args) => {
        await requireNeonFluxService(ctx, disabledLegacyMutationServices);
        const reactionRoleMessageId = unwrap(normalizeRequiredReactionRoleMessageId(args.reactionRoleMessageId));

        const messageId = parseReactionRoleMessageId(reactionRoleMessageId);
        await requireReactionRoleMessage(ctx, messageId);

        return await upsertReactionRoleOptionDocument(ctx, { ...args, reactionRoleMessageId: messageId });
    },
});

export const upsertReactionRoleOptionByMessage = mutation({
    args: {
        emojiKey: v.string(),
        guildId: v.string(),
        messageId: v.string(),
        position: v.optional(v.number()),
        roleId: v.string(),
    },
    returns: optionRecordValidator,
    handler: async (ctx: ReactionRolesMutationCtx, args) => {
        await requireNeonFluxService(ctx, disabledLegacyMutationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const message = await findReactionRoleMessageDocument(ctx, { guildId, messageId });

        if (!message) throw new Error('reaction-role-message-not-found');

        return await upsertReactionRoleOptionDocument(ctx, {
            emojiKey: args.emojiKey,
            reactionRoleMessageId: message._id,
            roleId: args.roleId,
            ...(args.position === undefined ? {} : { position: args.position }),
        });
    },
});

export const deleteReactionRoleOption = mutation({
    args: { emojiKey: v.string(), reactionRoleMessageId: v.string() },
    returns: v.union(optionRecordValidator, v.null()),
    handler: async (ctx: ReactionRolesMutationCtx, args) => {
        await requireNeonFluxService(ctx, disabledLegacyMutationServices);

        return await deleteReactionRoleOptionDocument(ctx, args);
    },
});

export const findReactionRoleOption = query({
    args: { emojiKey: v.string(), reactionRoleMessageId: v.string() },
    returns: v.union(optionRecordValidator, v.null()),
    handler: async (ctx: ReactionRolesQueryCtx, args) => {
        await requireNeonFluxService(ctx, readableReactionRoleServices);
        const reactionRoleMessageId = parseReactionRoleMessageId(
            unwrap(normalizeRequiredReactionRoleMessageId(args.reactionRoleMessageId))
        );
        const emojiKey = unwrap(normalizeRequiredEmojiKey(args.emojiKey));
        const option = await findReactionRoleOptionDocument(ctx, { emojiKey, reactionRoleMessageId });

        return option ? toReactionRoleOptionRecord(option) : null;
    },
});

async function upsertReactionRoleOptionDocument(
    ctx: ReactionRolesMutationCtx,
    input: {
        createdAt?: string;
        emojiKey: string;
        position?: number;
        reactionRoleMessageId: GenericId<'reactionRoleMessages'>;
        roleId: string;
        updatedAt?: string;
    }
) {
    const existingOption = await findReactionRoleOptionDocument(ctx, input);
    const document = unwrap(
        buildReactionRoleOptionDocument(input, new Date().toISOString(), existingOption ?? undefined)
    );

    if (existingOption) {
        await ctx.db.patch('reactionRoleOptions', existingOption._id, {
            position: document.position,
            roleId: document.roleId,
            updatedAt: document.updatedAt,
        });
        return toReactionRoleOptionRecord({ ...existingOption, ...document });
    } else {
        const id = await ctx.db.insert('reactionRoleOptions', document);
        return toReactionRoleOptionRecord({ ...document, _id: id });
    }
}

async function deleteReactionRoleOptionDocument(
    ctx: ReactionRolesMutationCtx,
    input: { emojiKey: string; reactionRoleMessageId: string }
) {
    const reactionRoleMessageId = parseReactionRoleMessageId(
        unwrap(normalizeRequiredReactionRoleMessageId(input.reactionRoleMessageId))
    );
    const emojiKey = unwrap(normalizeRequiredEmojiKey(input.emojiKey));
    const option = await findReactionRoleOptionDocument(ctx, { emojiKey, reactionRoleMessageId });

    if (!option) return null;

    await ctx.db.delete('reactionRoleOptions', option._id);

    return toReactionRoleOptionRecord(option);
}

async function findReactionRoleMessageDocument(
    ctx: ReactionRolesQueryCtx | ReactionRolesMutationCtx,
    input: { guildId: string; messageId: string }
): Promise<StoredReactionRoleMessageDocument | null> {
    return await ctx.db
        .query('reactionRoleMessages')
        .withIndex('by_guild_message', (query) =>
            query.eq('guildId', input.guildId).eq('messageId', input.messageId.trim())
        )
        .unique();
}

async function requireReactionRoleMessage(
    ctx: ReactionRolesMutationCtx,
    id: GenericId<'reactionRoleMessages'>
): Promise<StoredReactionRoleMessageDocument> {
    const message = await ctx.db.get('reactionRoleMessages', id);

    if (!message) {
        throw new Error('reaction-role-message-not-found');
    }

    return message;
}

async function listOptionsByMessageId(
    ctx: ReactionRolesQueryCtx | ReactionRolesMutationCtx,
    reactionRoleMessageId: GenericId<'reactionRoleMessages'>
): Promise<StoredReactionRoleOptionDocument[]> {
    return await ctx.db
        .query('reactionRoleOptions')
        .withIndex('by_message_position', (query) => query.eq('reactionRoleMessageId', reactionRoleMessageId))
        .order('asc')
        .take(500);
}

async function findReactionRoleOptionDocument(
    ctx: ReactionRolesQueryCtx | ReactionRolesMutationCtx,
    input: { emojiKey: string; reactionRoleMessageId: GenericId<'reactionRoleMessages'> }
): Promise<StoredReactionRoleOptionDocument | null> {
    return await ctx.db
        .query('reactionRoleOptions')
        .withIndex('by_message_emoji', (query) =>
            query.eq('reactionRoleMessageId', input.reactionRoleMessageId).eq('emojiKey', input.emojiKey.trim())
        )
        .unique();
}

async function requireGuildDocument(ctx: ReactionRolesMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) {
        throw new Error('guild-not-found');
    }

    return guild;
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) {
        const error = result.error;

        if (typeof error === 'object' && error !== null && 'type' in error) {
            throw new Error(String(error.type));
        }

        throw new Error(String(error));
    }

    return result.value;
}

function parseReactionRoleMessageId(value: string): GenericId<'reactionRoleMessages'> {
    return value as GenericId<'reactionRoleMessages'>;
}
