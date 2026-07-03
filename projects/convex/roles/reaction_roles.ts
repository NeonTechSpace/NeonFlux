import {
    mutationGeneric,
    queryGeneric,
    type DataModelFromSchemaDefinition,
    type GenericMutationCtx,
    type GenericQueryCtx,
} from 'convex/server';
import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    buildReactionRoleAssignmentDocument,
    buildReactionRoleMessageDocument,
    buildReactionRoleOptionDocument,
    normalizeLimit,
    normalizeRequiredEmojiKey,
    normalizeRequiredGuildId,
    normalizeRequiredMessageId,
    normalizeRequiredReactionRoleMessageId,
    normalizeRequiredRoleId,
    normalizeRequiredUserId,
    toReactionRoleAssignmentRecord,
    toReactionRoleMessageRecord,
    toReactionRoleOptionRecord,
    type ReactionRoleAssignmentDocument,
    type ReactionRoleMessageDocument,
    type ReactionRoleOptionDocument,
} from './reaction_roles_model.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type ReactionRolesQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type ReactionRolesMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredReactionRoleMessageDocument = ReactionRoleMessageDocument & { _id: GenericId<'reactionRoleMessages'> };
type StoredReactionRoleOptionDocument = ReactionRoleOptionDocument & { _id: GenericId<'reactionRoleOptions'> };
type StoredReactionRoleAssignmentDocument = ReactionRoleAssignmentDocument & {
    _id: GenericId<'reactionRoleAssignments'>;
};

const allowedReactionRoleServices = ['bot', 'web', 'migration'] as const;
const messageRecordValidator = v.object({
    channelId: v.string(),
    createdAt: v.string(),
    enabled: v.boolean(),
    generateOverview: v.boolean(),
    guildId: v.string(),
    id: v.string(),
    kind: v.string(),
    messageContent: v.union(v.string(), v.null()),
    messageEmbeds: v.array(v.any()),
    messageId: v.string(),
    mode: v.union(v.literal('normal'), v.literal('exclusive')),
    source: v.union(v.literal('existing'), v.literal('dashboard')),
    staleAt: v.union(v.string(), v.null()),
    updatedAt: v.string(),
});
const optionRecordValidator = v.object({
    createdAt: v.string(),
    emojiKey: v.string(),
    id: v.string(),
    position: v.number(),
    reactionRoleMessageId: v.string(),
    roleId: v.string(),
    updatedAt: v.string(),
});
const assignmentRecordValidator = v.object({
    assignedAt: v.string(),
    emojiKey: v.string(),
    guildId: v.string(),
    id: v.string(),
    messageId: v.string(),
    removedAt: v.union(v.string(), v.null()),
    roleId: v.string(),
    userId: v.string(),
});
const messageWithOptionsValidator = v.object({
    channelId: v.string(),
    createdAt: v.string(),
    enabled: v.boolean(),
    generateOverview: v.boolean(),
    guildId: v.string(),
    id: v.string(),
    kind: v.string(),
    messageContent: v.union(v.string(), v.null()),
    messageEmbeds: v.array(v.any()),
    messageId: v.string(),
    mode: v.union(v.literal('normal'), v.literal('exclusive')),
    options: v.array(optionRecordValidator),
    source: v.union(v.literal('existing'), v.literal('dashboard')),
    staleAt: v.union(v.string(), v.null()),
    updatedAt: v.string(),
});
const optionMatchValidator = v.object({
    message: messageRecordValidator,
    option: optionRecordValidator,
});

export const upsertReactionRoleMessage = mutationGeneric({
    args: {
        channelId: v.string(),
        createdAt: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        generateOverview: v.optional(v.boolean()),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
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
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
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
                existingMessage ?? undefined,
                () => crypto.randomUUID()
            )
        );

        if (existingMessage) {
            await ctx.db.patch(existingMessage._id, {
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
        } else {
            await ctx.db.insert('reactionRoleMessages', document);
        }

        return toReactionRoleMessageRecord(document);
    },
});

export const listReactionRoleMessagesByGuildId = queryGeneric({
    args: { guildId: v.string(), limit: v.optional(v.number()) },
    returns: v.array(messageWithOptionsValidator),
    handler: async (ctx: ReactionRolesQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messages = await ctx.db
            .query('reactionRoleMessages')
            .withIndex('by_guild_channel_message', (query) => query.eq('guildId', guildId))
            .order('asc')
            .take(normalizeLimit(args.limit));

        return await Promise.all(
            messages.map(async (message) => ({
                ...toReactionRoleMessageRecord(message),
                options: (await listOptionsByMessageLegacyId(ctx, message.legacyId)).map(toReactionRoleOptionRecord),
            }))
        );
    },
});

export const findReactionRoleMessage = queryGeneric({
    args: { guildId: v.string(), messageId: v.string() },
    returns: v.union(messageRecordValidator, v.null()),
    handler: async (ctx: ReactionRolesQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const message = await findReactionRoleMessageDocument(ctx, { guildId, messageId });

        return message ? toReactionRoleMessageRecord(message) : null;
    },
});

export const findEnabledReactionRoleOptionByReaction = queryGeneric({
    args: { emojiKey: v.string(), guildId: v.string(), messageId: v.string() },
    returns: v.union(optionMatchValidator, v.null()),
    handler: async (ctx: ReactionRolesQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const emojiKey = unwrap(normalizeRequiredEmojiKey(args.emojiKey));
        const message = await findReactionRoleMessageDocument(ctx, { guildId, messageId });

        if (!message?.enabled || message.staleAt) return null;

        const option = await findReactionRoleOptionDocument(ctx, {
            emojiKey,
            reactionRoleMessageId: message.legacyId,
        });

        return option
            ? {
                  message: toReactionRoleMessageRecord(message),
                  option: toReactionRoleOptionRecord(option),
              }
            : null;
    },
});

export const deleteReactionRoleMessage = mutationGeneric({
    args: { guildId: v.string(), messageId: v.string() },
    returns: v.union(messageRecordValidator, v.null()),
    handler: async (ctx: ReactionRolesMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const message = await findReactionRoleMessageDocument(ctx, { guildId, messageId });

        if (!message) return null;

        const options = await listOptionsByMessageLegacyId(ctx, message.legacyId);

        for (const option of options) {
            await ctx.db.delete(option._id);
        }

        await ctx.db.delete(message._id);

        return toReactionRoleMessageRecord(message);
    },
});

export const upsertReactionRoleOption = mutationGeneric({
    args: {
        createdAt: v.optional(v.string()),
        emojiKey: v.string(),
        legacyId: v.optional(v.string()),
        position: v.optional(v.number()),
        reactionRoleMessageId: v.string(),
        roleId: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: optionRecordValidator,
    handler: async (ctx: ReactionRolesMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
        const reactionRoleMessageId = unwrap(normalizeRequiredReactionRoleMessageId(args.reactionRoleMessageId));

        await requireReactionRoleMessageByLegacyId(ctx, reactionRoleMessageId);

        return await upsertReactionRoleOptionDocument(ctx, { ...args, reactionRoleMessageId });
    },
});

export const upsertReactionRoleOptionByMessage = mutationGeneric({
    args: {
        emojiKey: v.string(),
        guildId: v.string(),
        messageId: v.string(),
        position: v.optional(v.number()),
        roleId: v.string(),
    },
    returns: optionRecordValidator,
    handler: async (ctx: ReactionRolesMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const message = await findReactionRoleMessageDocument(ctx, { guildId, messageId });

        if (!message) throw new Error('reaction-role-message-not-found');

        return await upsertReactionRoleOptionDocument(ctx, {
            emojiKey: args.emojiKey,
            reactionRoleMessageId: message.legacyId,
            roleId: args.roleId,
            ...(args.position === undefined ? {} : { position: args.position }),
        });
    },
});

export const deleteReactionRoleOptionByMessage = mutationGeneric({
    args: { emojiKey: v.string(), guildId: v.string(), messageId: v.string() },
    returns: v.union(optionRecordValidator, v.null()),
    handler: async (ctx: ReactionRolesMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const message = await findReactionRoleMessageDocument(ctx, { guildId, messageId });

        if (!message) return null;

        return await deleteReactionRoleOptionDocument(ctx, {
            emojiKey: args.emojiKey,
            reactionRoleMessageId: message.legacyId,
        });
    },
});

export const deleteReactionRoleOption = mutationGeneric({
    args: { emojiKey: v.string(), reactionRoleMessageId: v.string() },
    returns: v.union(optionRecordValidator, v.null()),
    handler: async (ctx: ReactionRolesMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);

        return await deleteReactionRoleOptionDocument(ctx, args);
    },
});

export const findReactionRoleOption = queryGeneric({
    args: { emojiKey: v.string(), reactionRoleMessageId: v.string() },
    returns: v.union(optionRecordValidator, v.null()),
    handler: async (ctx: ReactionRolesQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
        const reactionRoleMessageId = unwrap(normalizeRequiredReactionRoleMessageId(args.reactionRoleMessageId));
        const emojiKey = unwrap(normalizeRequiredEmojiKey(args.emojiKey));
        const option = await findReactionRoleOptionDocument(ctx, { emojiKey, reactionRoleMessageId });

        return option ? toReactionRoleOptionRecord(option) : null;
    },
});

export const upsertReactionRoleAssignment = mutationGeneric({
    args: {
        assignedAt: v.optional(v.string()),
        emojiKey: v.string(),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        messageId: v.string(),
        removedAt: v.optional(v.union(v.string(), v.null())),
        roleId: v.string(),
        userId: v.string(),
    },
    returns: assignmentRecordValidator,
    handler: async (ctx: ReactionRolesMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existingAssignment = await findReactionRoleAssignmentDocument(ctx, {
            guildId,
            messageId: args.messageId,
            roleId: args.roleId,
            userId: args.userId,
        });
        const document = unwrap(
            buildReactionRoleAssignmentDocument(
                {
                    ...args,
                    guildId,
                },
                new Date().toISOString(),
                existingAssignment ?? undefined,
                () => crypto.randomUUID()
            )
        );

        if (existingAssignment) {
            await ctx.db.patch(existingAssignment._id, {
                assignedAt: document.assignedAt,
                emojiKey: document.emojiKey,
                removedAt: document.removedAt,
            });
        } else {
            await ctx.db.insert('reactionRoleAssignments', document);
        }

        return toReactionRoleAssignmentRecord(document);
    },
});

export const markReactionRoleAssignmentRemoved = mutationGeneric({
    args: { guildId: v.string(), messageId: v.string(), roleId: v.string(), userId: v.string() },
    returns: v.union(assignmentRecordValidator, v.null()),
    handler: async (ctx: ReactionRolesMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
        const input = normalizeAssignmentIdentity(args);
        const assignment = await findReactionRoleAssignmentDocument(ctx, input);

        if (!assignment) return null;

        const removedAt = new Date().toISOString();

        await ctx.db.patch(assignment._id, { removedAt });

        return toReactionRoleAssignmentRecord({ ...assignment, removedAt });
    },
});

export const listActiveReactionRoleAssignmentsByGuildUser = queryGeneric({
    args: { guildId: v.string(), limit: v.optional(v.number()), userId: v.string() },
    returns: v.array(assignmentRecordValidator),
    handler: async (ctx: ReactionRolesQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const assignments = await ctx.db
            .query('reactionRoleAssignments')
            .withIndex('by_guild_user', (query) => query.eq('guildId', guildId).eq('userId', userId))
            .filter((query) => query.eq(query.field('removedAt'), undefined))
            .take(normalizeLimit(args.limit));

        return assignments.sort(compareAssignmentsByRole).map(toReactionRoleAssignmentRecord);
    },
});

export const listActiveReactionRoleAssignmentsByGuildMessageUser = queryGeneric({
    args: { guildId: v.string(), limit: v.optional(v.number()), messageId: v.string(), userId: v.string() },
    returns: v.array(assignmentRecordValidator),
    handler: async (ctx: ReactionRolesQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const assignments = await ctx.db
            .query('reactionRoleAssignments')
            .withIndex('by_guild_message_user', (query) =>
                query.eq('guildId', guildId).eq('messageId', messageId).eq('userId', userId)
            )
            .filter((query) => query.eq(query.field('removedAt'), undefined))
            .take(normalizeLimit(args.limit));

        return assignments.sort(compareAssignmentsByAssignedAt).map(toReactionRoleAssignmentRecord);
    },
});

export const markReactionRoleAssignmentsRemovedByMessageUser = mutationGeneric({
    args: { guildId: v.string(), messageId: v.string(), userId: v.string() },
    returns: v.array(assignmentRecordValidator),
    handler: async (ctx: ReactionRolesMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedReactionRoleServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const assignments = await ctx.db
            .query('reactionRoleAssignments')
            .withIndex('by_guild_message_user', (query) =>
                query.eq('guildId', guildId).eq('messageId', messageId).eq('userId', userId)
            )
            .filter((query) => query.eq(query.field('removedAt'), undefined))
            .take(500);
        const removedAt = new Date().toISOString();

        for (const assignment of assignments) {
            await ctx.db.patch(assignment._id, { removedAt });
        }

        return assignments
            .map((assignment) => toReactionRoleAssignmentRecord({ ...assignment, removedAt }))
            .sort(compareAssignmentRecordsByAssignedAt);
    },
});

async function upsertReactionRoleOptionDocument(
    ctx: ReactionRolesMutationCtx,
    input: {
        createdAt?: string;
        emojiKey: string;
        legacyId?: string;
        position?: number;
        reactionRoleMessageId: string;
        roleId: string;
        updatedAt?: string;
    }
) {
    const existingOption = await findReactionRoleOptionDocument(ctx, input);
    const document = unwrap(
        buildReactionRoleOptionDocument(input, new Date().toISOString(), existingOption ?? undefined, () =>
            crypto.randomUUID()
        )
    );

    if (existingOption) {
        await ctx.db.patch(existingOption._id, {
            position: document.position,
            roleId: document.roleId,
            updatedAt: document.updatedAt,
        });
    } else {
        await ctx.db.insert('reactionRoleOptions', document);
    }

    return toReactionRoleOptionRecord(document);
}

async function deleteReactionRoleOptionDocument(
    ctx: ReactionRolesMutationCtx,
    input: { emojiKey: string; reactionRoleMessageId: string }
) {
    const reactionRoleMessageId = unwrap(normalizeRequiredReactionRoleMessageId(input.reactionRoleMessageId));
    const emojiKey = unwrap(normalizeRequiredEmojiKey(input.emojiKey));
    const option = await findReactionRoleOptionDocument(ctx, { emojiKey, reactionRoleMessageId });

    if (!option) return null;

    await ctx.db.delete(option._id);

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

async function requireReactionRoleMessageByLegacyId(
    ctx: ReactionRolesMutationCtx,
    legacyId: string
): Promise<StoredReactionRoleMessageDocument> {
    const message = await ctx.db
        .query('reactionRoleMessages')
        .withIndex('by_legacy', (query) => query.eq('legacyId', legacyId))
        .unique();

    if (!message) {
        throw new Error('reaction-role-message-not-found');
    }

    return message;
}

async function listOptionsByMessageLegacyId(
    ctx: ReactionRolesQueryCtx | ReactionRolesMutationCtx,
    reactionRoleMessageId: string
): Promise<StoredReactionRoleOptionDocument[]> {
    return await ctx.db
        .query('reactionRoleOptions')
        .withIndex('by_message_position', (query) => query.eq('reactionRoleMessageLegacyId', reactionRoleMessageId))
        .order('asc')
        .take(500);
}

async function findReactionRoleOptionDocument(
    ctx: ReactionRolesQueryCtx | ReactionRolesMutationCtx,
    input: { emojiKey: string; reactionRoleMessageId: string }
): Promise<StoredReactionRoleOptionDocument | null> {
    return await ctx.db
        .query('reactionRoleOptions')
        .withIndex('by_message_emoji', (query) =>
            query.eq('reactionRoleMessageLegacyId', input.reactionRoleMessageId).eq('emojiKey', input.emojiKey.trim())
        )
        .unique();
}

async function findReactionRoleAssignmentDocument(
    ctx: ReactionRolesQueryCtx | ReactionRolesMutationCtx,
    input: { guildId: string; messageId: string; roleId: string; userId: string }
): Promise<StoredReactionRoleAssignmentDocument | null> {
    const normalized = normalizeAssignmentIdentity(input);

    return await ctx.db
        .query('reactionRoleAssignments')
        .withIndex('by_guild_message_user_role', (query) =>
            query
                .eq('guildId', normalized.guildId)
                .eq('messageId', normalized.messageId)
                .eq('userId', normalized.userId)
                .eq('roleId', normalized.roleId)
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

function normalizeAssignmentIdentity(input: { guildId: string; messageId: string; roleId: string; userId: string }) {
    return {
        guildId: unwrap(normalizeRequiredGuildId(input.guildId)),
        messageId: unwrap(normalizeRequiredMessageId(input.messageId)),
        roleId: unwrap(normalizeRequiredRoleId(input.roleId)),
        userId: unwrap(normalizeRequiredUserId(input.userId)),
    };
}

function compareAssignmentsByRole(
    left: StoredReactionRoleAssignmentDocument,
    right: StoredReactionRoleAssignmentDocument
): number {
    return left.roleId.localeCompare(right.roleId);
}

function compareAssignmentsByAssignedAt(
    left: StoredReactionRoleAssignmentDocument,
    right: StoredReactionRoleAssignmentDocument
): number {
    return left.assignedAt.localeCompare(right.assignedAt) || left.roleId.localeCompare(right.roleId);
}

function compareAssignmentRecordsByAssignedAt(
    left: ReturnType<typeof toReactionRoleAssignmentRecord>,
    right: ReturnType<typeof toReactionRoleAssignmentRecord>
): number {
    return left.assignedAt.localeCompare(right.assignedAt) || left.roleId.localeCompare(right.roleId);
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
