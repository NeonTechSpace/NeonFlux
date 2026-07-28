import { v } from 'convex/values';

import { internal } from '../_generated/api.js';
import { internalMutation } from '../_generated/server.js';
import { dataRetentionCutoff, readDataRetentionDays } from '../retention/retention_policy.js';

const deleteBatchSize = 100;

export const pruneReactionRoleHistoryBatch = internalMutation({
    args: {
        cutoff: v.optional(v.string()),
    },
    returns: v.object({
        deletedCount: v.number(),
        hasMore: v.boolean(),
    }),
    handler: async (ctx, args) => {
        const cutoff = args.cutoff ?? dataRetentionCutoff(new Date().toISOString(), readDataRetentionDays());
        const panel = (
            await ctx.db
                .query('reactionRolePanels')
                .withIndex('by_status_updated', (queryBuilder) =>
                    queryBuilder.eq('status', 'inactive').lt('updatedAt', cutoff)
                )
                .take(1)
        )[0];
        if (!panel) return { deletedCount: 0, hasMore: false };

        const [dirtyUsers, selections, memberOperations, panelOperations, versions] = await Promise.all([
            ctx.db
                .query('reactionRoleReconciliationDirtyUsers')
                .withIndex('by_panel_updated', (queryBuilder) => queryBuilder.eq('panelId', panel._id))
                .take(deleteBatchSize),
            ctx.db
                .query('reactionRoleSelections')
                .withIndex('by_panel_user', (queryBuilder) => queryBuilder.eq('panelId', panel._id))
                .take(deleteBatchSize),
            ctx.db
                .query('reactionRoleMemberOperations')
                .withIndex('by_panel_user', (queryBuilder) => queryBuilder.eq('panelId', panel._id))
                .take(deleteBatchSize),
            ctx.db
                .query('reactionRolePanelOperations')
                .withIndex('by_panel_updated', (queryBuilder) => queryBuilder.eq('panelId', panel._id))
                .take(deleteBatchSize),
            ctx.db
                .query('reactionRolePanelVersions')
                .withIndex('by_panel_version', (queryBuilder) => queryBuilder.eq('panelId', panel._id))
                .take(deleteBatchSize),
        ]);
        let deletedCount: number;
        if (dirtyUsers.length > 0) {
            for (const document of dirtyUsers) {
                await ctx.db.delete('reactionRoleReconciliationDirtyUsers', document._id);
            }
            deletedCount = dirtyUsers.length;
        } else if (selections.length > 0) {
            for (const document of selections) await ctx.db.delete('reactionRoleSelections', document._id);
            deletedCount = selections.length;
        } else if (memberOperations.length > 0) {
            for (const document of memberOperations) {
                await ctx.db.delete('reactionRoleMemberOperations', document._id);
            }
            deletedCount = memberOperations.length;
        } else if (panelOperations.length > 0) {
            for (const document of panelOperations) {
                await ctx.db.delete('reactionRolePanelOperations', document._id);
            }
            deletedCount = panelOperations.length;
        } else if (versions.length > 0) {
            for (const document of versions) await ctx.db.delete('reactionRolePanelVersions', document._id);
            deletedCount = versions.length;
        } else {
            await ctx.db.delete('reactionRolePanels', panel._id);
            deletedCount = 1;
        }
        await ctx.scheduler.runAfter(0, internal.reaction_roles.reaction_role_retention.pruneReactionRoleHistoryBatch, {
            cutoff,
        });
        return { deletedCount, hasMore: true };
    },
});
