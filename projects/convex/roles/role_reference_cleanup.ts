import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    createEmptyDeletedRoleCleanupSummary,
    hasDeletedRoleCleanupChanges,
    normalizeDeletedRoleCleanupInput,
    removeRoleIdFromConfigArray,
    removeRoleIdFromStringArray,
    shouldDisablePrivateTicketPanel,
} from './role_reference_cleanup_model.js';
import {
    buildRoleReconciliationActionDocument,
    buildRoleReconciliationRunDocument,
} from './role_reconciliation_model.js';
import { mutation, type MutationCtx } from '../_generated/server.js';
type RoleReferenceCleanupMutationCtx = MutationCtx;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredReactionRoleMessageDocument = {
    _id: GenericId<'reactionRoleMessages'>;
    guildId: string;
};

const allowedRoleReferenceCleanupServices = ['bot'] as const;
const cleanupScanLimit = 5000;
const summaryValidator = v.object({
    autoroleRulesDisabled: v.number(),
    commandPermissionRulesUpdated: v.number(),
    dashboardPermissionRulesUpdated: v.number(),
    moderationPoliciesUpdated: v.number(),
    reactionRoleAssignmentsRemoved: v.number(),
    reactionRoleOptionsDeleted: v.number(),
    ticketPanelsDisabled: v.number(),
    ticketPanelsUpdated: v.number(),
    verificationFlowsDisabled: v.number(),
    xpRoleRewardsDeleted: v.number(),
});
const cleanupResultValidator = v.union(
    v.object({
        runId: v.string(),
        status: v.literal('cleaned'),
        summary: summaryValidator,
    }),
    v.object({
        status: v.literal('unchanged'),
        summary: summaryValidator,
    })
);

export const cleanupDeletedGuildRoleReferences = mutation({
    args: {
        guildId: v.string(),
        occurredAt: v.optional(v.string()),
        roleId: v.string(),
    },
    returns: cleanupResultValidator,
    handler: async (ctx: RoleReferenceCleanupMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedRoleReferenceCleanupServices);
        const input = unwrap(normalizeDeletedRoleCleanupInput(args, new Date().toISOString()));

        await requireGuildDocument(ctx, input.guildId);

        const summary = createEmptyDeletedRoleCleanupSummary();

        summary.autoroleRulesDisabled = await disableAutoroleRules(ctx, input);
        summary.reactionRoleOptionsDeleted = await deleteReactionRoleOptions(ctx, input);
        summary.reactionRoleAssignmentsRemoved = await markReactionRoleAssignmentsRemoved(ctx, input);
        summary.verificationFlowsDisabled = await disableVerificationFlows(ctx, input);
        summary.moderationPoliciesUpdated = await removeModerationProtectedRole(ctx, input);

        const ticketCleanup = await removeTicketPanelStaffRole(ctx, input);
        summary.ticketPanelsUpdated = ticketCleanup.updated;
        summary.ticketPanelsDisabled = ticketCleanup.disabled;

        summary.commandPermissionRulesUpdated = await removeCommandPermissionRole(ctx, input);
        summary.dashboardPermissionRulesUpdated = await removeDashboardPermissionRole(ctx, input);
        summary.xpRoleRewardsDeleted = await deleteXpRoleRewards(ctx, input);

        if (!hasDeletedRoleCleanupChanges(summary)) {
            return {
                status: 'unchanged' as const,
                summary,
            };
        }

        const run = unwrap(
            buildRoleReconciliationRunDocument(
                {
                    createdAt: input.updatedAt,
                    guildId: input.guildId,
                    status: 'applied',
                    summary: {
                        event: 'role.deleted',
                        roleId: input.roleId,
                        ...summary,
                    },
                    updatedAt: input.updatedAt,
                },
                input.updatedAt
            )
        );

        const runId = await ctx.db.insert('roleReconciliationRuns', run);

        const action = unwrap(
            buildRoleReconciliationActionDocument(
                {
                    actionType: 'guild.role_deleted_references_cleaned',
                    createdAt: input.updatedAt,
                    details: summary,
                    roleId: input.roleId,
                    runId,
                    status: 'applied',
                    updatedAt: input.updatedAt,
                },
                input.updatedAt
            )
        );

        await ctx.db.insert('roleReconciliationActions', action);

        return {
            runId,
            status: 'cleaned' as const,
            summary,
        };
    },
});

async function disableAutoroleRules(
    ctx: RoleReferenceCleanupMutationCtx,
    input: { guildId: string; roleId: string; updatedAt: string }
): Promise<number> {
    const rules = await ctx.db
        .query('autoroleRules')
        .withIndex('by_guild_enabled_role', (query) =>
            query.eq('guildId', input.guildId).eq('enabled', true).eq('roleId', input.roleId)
        )
        .take(cleanupScanLimit);
    let updated = 0;

    assertBelowCleanupLimit(rules.length, 'autorole-rules');

    for (const rule of rules) {
        await ctx.db.patch(rule._id, {
            enabled: false,
            updatedAt: input.updatedAt,
        });
        updated += 1;
    }

    return updated;
}

async function deleteReactionRoleOptions(
    ctx: RoleReferenceCleanupMutationCtx,
    input: { guildId: string; roleId: string }
): Promise<number> {
    const options = await ctx.db
        .query('reactionRoleOptions')
        .withIndex('by_role', (query) => query.eq('roleId', input.roleId))
        .take(cleanupScanLimit);
    let deleted = 0;

    assertBelowCleanupLimit(options.length, 'reaction-role-options');

    for (const option of options) {
        const message = await findReactionRoleMessage(ctx, option.reactionRoleMessageId);

        if (message?.guildId !== input.guildId) {
            continue;
        }

        await ctx.db.delete(option._id);
        deleted += 1;
    }

    return deleted;
}

async function markReactionRoleAssignmentsRemoved(
    ctx: RoleReferenceCleanupMutationCtx,
    input: { guildId: string; roleId: string; updatedAt: string }
): Promise<number> {
    const assignments = await ctx.db
        .query('reactionRoleAssignments')
        .withIndex('by_guild_role', (query) => query.eq('guildId', input.guildId).eq('roleId', input.roleId))
        .take(cleanupScanLimit);
    let updated = 0;

    assertBelowCleanupLimit(assignments.length, 'reaction-role-assignments');

    for (const assignment of assignments) {
        if (assignment.removedAt) {
            continue;
        }

        await ctx.db.patch(assignment._id, {
            removedAt: input.updatedAt,
        });
        updated += 1;
    }

    return updated;
}

async function disableVerificationFlows(
    ctx: RoleReferenceCleanupMutationCtx,
    input: { guildId: string; roleId: string; updatedAt: string }
): Promise<number> {
    const flows = await ctx.db
        .query('verificationFlows')
        .withIndex('by_guild_role', (query) => query.eq('guildId', input.guildId).eq('verifiedRoleId', input.roleId))
        .take(cleanupScanLimit);
    let updated = 0;

    assertBelowCleanupLimit(flows.length, 'verification-flows');

    for (const flow of flows) {
        if (!flow.enabled) {
            continue;
        }

        await ctx.db.patch(flow._id, {
            enabled: false,
            updatedAt: input.updatedAt,
        });
        updated += 1;
    }

    return updated;
}

async function removeModerationProtectedRole(
    ctx: RoleReferenceCleanupMutationCtx,
    input: { guildId: string; roleId: string; updatedAt: string }
): Promise<number> {
    const setting = await ctx.db
        .query('guildFeatureSettings')
        .withIndex('by_guild_feature', (query) => query.eq('guildId', input.guildId).eq('feature', 'moderation'))
        .unique();
    const removal = removeRoleIdFromConfigArray(setting?.config, 'protectedRoleIds', input.roleId);

    if (!setting || !removal.changed) {
        return 0;
    }

    await ctx.db.patch(setting._id, {
        config: removal.config,
        updatedAt: input.updatedAt,
    });

    return 1;
}

async function removeTicketPanelStaffRole(
    ctx: RoleReferenceCleanupMutationCtx,
    input: { guildId: string; roleId: string; updatedAt: string }
): Promise<{ disabled: number; updated: number }> {
    const panels = await ctx.db
        .query('ticketPanels')
        .withIndex('by_guild_created', (query) => query.eq('guildId', input.guildId))
        .take(cleanupScanLimit);
    let disabled = 0;
    let updated = 0;

    assertBelowCleanupLimit(panels.length, 'ticket-panels');

    for (const panel of panels) {
        const removal = removeRoleIdFromConfigArray(panel.config, 'staffRoleIds', input.roleId);

        if (!removal.changed) {
            continue;
        }

        const shouldDisable = shouldDisablePrivateTicketPanel({
            config: removal.config,
            enabled: panel.enabled,
            staffRoleIds: removal.values,
        });

        await ctx.db.patch(panel._id, {
            config: removal.config,
            enabled: shouldDisable ? false : panel.enabled,
            updatedAt: input.updatedAt,
        });

        disabled += shouldDisable ? 1 : 0;
        updated += 1;
    }

    return { disabled, updated };
}

async function removeCommandPermissionRole(
    ctx: RoleReferenceCleanupMutationCtx,
    input: { guildId: string; roleId: string; updatedAt: string }
): Promise<number> {
    const rules = await ctx.db
        .query('guildCommandPermissionRules')
        .withIndex('by_guild', (query) => query.eq('guildId', input.guildId))
        .take(cleanupScanLimit);
    let updated = 0;

    assertBelowCleanupLimit(rules.length, 'command-permission-rules');

    for (const rule of rules) {
        const removal = removeRoleIdFromStringArray(rule.roleIds, input.roleId);

        if (!removal.changed) {
            continue;
        }

        await ctx.db.patch(rule._id, {
            roleIds: removal.values,
            updatedAt: input.updatedAt,
        });
        updated += 1;
    }

    return updated;
}

async function removeDashboardPermissionRole(
    ctx: RoleReferenceCleanupMutationCtx,
    input: { guildId: string; roleId: string; updatedAt: string }
): Promise<number> {
    const rule = await ctx.db
        .query('guildDashboardPermissionRules')
        .withIndex('by_guild_id', (query) => query.eq('guildId', input.guildId))
        .unique();
    const removal = removeRoleIdFromStringArray(rule?.roleIds, input.roleId);

    if (!rule || !removal.changed) {
        return 0;
    }

    await ctx.db.patch(rule._id, {
        roleIds: removal.values,
        updatedAt: input.updatedAt,
    });

    return 1;
}

async function deleteXpRoleRewards(
    ctx: RoleReferenceCleanupMutationCtx,
    input: { guildId: string; roleId: string }
): Promise<number> {
    const rewards = await ctx.db
        .query('xpRoleRewards')
        .withIndex('by_guild_role', (query) => query.eq('guildId', input.guildId).eq('roleId', input.roleId))
        .take(cleanupScanLimit);
    let deleted = 0;

    assertBelowCleanupLimit(rewards.length, 'xp-role-rewards');

    for (const reward of rewards) {
        await ctx.db.delete(reward._id);
        deleted += 1;
    }

    return deleted;
}

async function findReactionRoleMessage(
    ctx: RoleReferenceCleanupMutationCtx,
    id: GenericId<'reactionRoleMessages'>
): Promise<StoredReactionRoleMessageDocument | null> {
    return await ctx.db.get(id);
}

async function requireGuildDocument(
    ctx: RoleReferenceCleanupMutationCtx,
    guildId: string
): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) {
        throw new Error('guild-not-found');
    }

    return guild;
}

function assertBelowCleanupLimit(count: number, label: string): void {
    if (count >= cleanupScanLimit) {
        throw new Error(`role-reference-cleanup-scan-limit-exceeded:${label}`);
    }
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
