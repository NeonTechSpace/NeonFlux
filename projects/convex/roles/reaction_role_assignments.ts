import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
import {
    buildReactionRoleAssignmentDocument,
    normalizeLimit,
    normalizeRequiredGuildId,
    normalizeRequiredMessageId,
    normalizeRequiredRoleId,
    normalizeRequiredUserId,
    toReactionRoleAssignmentRecord,
    type ReactionRoleAssignmentDocument,
} from './reaction_roles_model.js';
import { assignmentRecordValidator } from './reaction_roles_validators.js';

type StoredAssignment = ReactionRoleAssignmentDocument & { _id: GenericId<'reactionRoleAssignments'> };
const readableServices = ['bot', 'web'] as const;
const disabledLegacyMutationServices = [] as const;

export const upsertReactionRoleAssignment = mutation({
    args: {
        assignedAt: v.optional(v.string()),
        emojiKey: v.string(),
        guildId: v.string(),
        messageId: v.string(),
        removedAt: v.optional(v.union(v.string(), v.null())),
        roleId: v.string(),
        userId: v.string(),
    },
    returns: assignmentRecordValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, disabledLegacyMutationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        await requireGuild(ctx, guildId);
        const parent = await findMessage(ctx, guildId, args.messageId);
        const existing = await findAssignment(ctx, args);
        const now = new Date().toISOString();
        const base = unwrap(buildReactionRoleAssignmentDocument({ ...args, guildId }, now));
        const document: ReactionRoleAssignmentDocument = {
            ...base,
            desiredState: base.removedAt ? 'absent' : 'present',
            ...(parent ? { reactionRoleMessageId: parent._id } : {}),
            status: base.removedAt ? 'pending' : 'applied',
            updatedAt: now,
        };

        if (existing) {
            await ctx.db.patch('reactionRoleAssignments', existing._id, document);
            return toReactionRoleAssignmentRecord({ ...existing, ...document });
        }
        const id = await ctx.db.insert('reactionRoleAssignments', document);
        return toReactionRoleAssignmentRecord({ ...document, _id: id });
    },
});

export const markReactionRoleAssignmentRemoved = mutation({
    args: { guildId: v.string(), messageId: v.string(), roleId: v.string(), userId: v.string() },
    returns: v.union(assignmentRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, disabledLegacyMutationServices);
        const assignment = await findAssignment(ctx, args);
        if (!assignment) return null;
        const now = new Date().toISOString();
        const patch = { desiredState: 'absent', removedAt: now, status: 'applied', updatedAt: now } as const;
        await ctx.db.patch('reactionRoleAssignments', assignment._id, patch);
        return toReactionRoleAssignmentRecord({ ...assignment, ...patch });
    },
});

export const listActiveReactionRoleAssignmentsByGuildUser = query({
    args: { guildId: v.string(), limit: v.optional(v.number()), userId: v.string() },
    returns: v.array(assignmentRecordValidator),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, readableServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const assignments = await ctx.db
            .query('reactionRoleAssignments')
            .withIndex('by_guild_user_removed', (query) =>
                query.eq('guildId', guildId).eq('userId', userId).eq('removedAt', undefined)
            )
            .take(normalizeLimit(args.limit));
        return assignments.sort((a, b) => a.roleId.localeCompare(b.roleId)).map(toReactionRoleAssignmentRecord);
    },
});

export const listActiveReactionRoleAssignmentsByGuildMessageUser = query({
    args: { guildId: v.string(), limit: v.optional(v.number()), messageId: v.string(), userId: v.string() },
    returns: v.array(assignmentRecordValidator),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, readableServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const assignments = await ctx.db
            .query('reactionRoleAssignments')
            .withIndex('by_guild_message_user_removed', (query) =>
                query.eq('guildId', guildId).eq('messageId', messageId).eq('userId', userId).eq('removedAt', undefined)
            )
            .take(normalizeLimit(args.limit));
        return assignments.sort(compareAssignments).map(toReactionRoleAssignmentRecord);
    },
});

export const markReactionRoleAssignmentsRemovedByMessageUser = mutation({
    args: { guildId: v.string(), messageId: v.string(), userId: v.string() },
    returns: v.array(assignmentRecordValidator),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, disabledLegacyMutationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const assignments = await ctx.db
            .query('reactionRoleAssignments')
            .withIndex('by_guild_message_user_removed', (query) =>
                query.eq('guildId', guildId).eq('messageId', messageId).eq('userId', userId).eq('removedAt', undefined)
            )
            .take(500);
        const now = new Date().toISOString();
        const patch = { desiredState: 'absent', removedAt: now, status: 'applied', updatedAt: now } as const;
        for (const assignment of assignments) await ctx.db.patch('reactionRoleAssignments', assignment._id, patch);
        return assignments
            .map((assignment) => toReactionRoleAssignmentRecord({ ...assignment, ...patch }))
            .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt) || a.roleId.localeCompare(b.roleId));
    },
});

async function findAssignment(
    ctx: QueryCtx | MutationCtx,
    input: { guildId: string; messageId: string; roleId: string; userId: string }
): Promise<StoredAssignment | null> {
    const guildId = unwrap(normalizeRequiredGuildId(input.guildId));
    const messageId = unwrap(normalizeRequiredMessageId(input.messageId));
    const roleId = unwrap(normalizeRequiredRoleId(input.roleId));
    const userId = unwrap(normalizeRequiredUserId(input.userId));
    return await ctx.db
        .query('reactionRoleAssignments')
        .withIndex('by_guild_message_user_role', (query) =>
            query.eq('guildId', guildId).eq('messageId', messageId).eq('userId', userId).eq('roleId', roleId)
        )
        .unique();
}

async function findMessage(ctx: MutationCtx, guildId: string, messageId: string) {
    return await ctx.db
        .query('reactionRoleMessages')
        .withIndex('by_guild_message', (query) => query.eq('guildId', guildId).eq('messageId', messageId.trim()))
        .unique();
}

async function requireGuild(ctx: MutationCtx, guildId: string) {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();
    if (!guild) throw new Error('guild-not-found');
}

function compareAssignments(left: StoredAssignment, right: StoredAssignment) {
    return left.assignedAt.localeCompare(right.assignedAt) || left.roleId.localeCompare(right.roleId);
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) throw new Error(String(result.error));
    return result.value;
}
