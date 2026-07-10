import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';

const botService = ['bot'] as const;
const leaseArgs = {
    guildId: v.string(),
    leaseExpiresAt: v.string(),
    leaseId: v.string(),
    leaseOwner: v.string(),
    now: v.string(),
    userId: v.string(),
};

export const acquireReactionRoleUserLease = mutation({
    args: leaseArgs,
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const existing = await findLease(ctx, args.guildId, args.userId);
        if (existing && existing.leaseId !== args.leaseId.trim() && existing.leaseExpiresAt > args.now) {
            return false;
        }
        const document = {
            guildId: args.guildId.trim(),
            leaseExpiresAt: args.leaseExpiresAt,
            leaseId: args.leaseId.trim(),
            leaseOwner: args.leaseOwner.trim(),
            updatedAt: args.now,
            userId: args.userId.trim(),
        };
        if (existing) await ctx.db.patch('reactionRoleUserLeases', existing._id, document);
        else await ctx.db.insert('reactionRoleUserLeases', document);
        return true;
    },
});

export const renewReactionRoleUserLease = mutation({
    args: leaseArgs,
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const existing = await findLease(ctx, args.guildId, args.userId);
        if (existing?.leaseId !== args.leaseId.trim()) return false;
        await ctx.db.patch('reactionRoleUserLeases', existing._id, {
            leaseExpiresAt: args.leaseExpiresAt,
            leaseOwner: args.leaseOwner.trim(),
            updatedAt: args.now,
        });
        return true;
    },
});

export const releaseReactionRoleUserLease = mutation({
    args: { guildId: v.string(), leaseId: v.string(), userId: v.string() },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const existing = await findLease(ctx, args.guildId, args.userId);
        if (existing?.leaseId !== args.leaseId.trim()) return false;
        await ctx.db.delete('reactionRoleUserLeases', existing._id);
        return true;
    },
});

export const hasOtherActiveReactionRoleAssignment = query({
    args: {
        assignmentId: v.string(),
        guildId: v.string(),
        roleId: v.string(),
        userId: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const assignmentId = args.assignmentId.trim() as GenericId<'reactionRoleAssignments'>;
        for (const desiredState of ['present', undefined] as const) {
            const assignments = await ctx.db
                .query('reactionRoleAssignments')
                .withIndex('by_guild_user_role_desired_removed', (builder) =>
                    builder
                        .eq('guildId', args.guildId.trim())
                        .eq('userId', args.userId.trim())
                        .eq('roleId', args.roleId.trim())
                        .eq('desiredState', desiredState)
                        .eq('removedAt', undefined)
                )
                .take(2);
            if (assignments.some((assignment) => assignment._id !== assignmentId)) return true;
        }
        return false;
    },
});

async function findLease(ctx: QueryCtx | MutationCtx, guildId: string, userId: string) {
    return await ctx.db
        .query('reactionRoleUserLeases')
        .withIndex('by_guild_user', (builder) => builder.eq('guildId', guildId.trim()).eq('userId', userId.trim()))
        .unique();
}
