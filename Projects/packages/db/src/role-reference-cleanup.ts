import { and, eq, inArray, isNull } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import {
    autoroleRules,
    guildCommandPermissionRules,
    guildDashboardPermissionRules,
    guildFeatureSettings,
    reactionRoleAssignments,
    reactionRoleMessages,
    reactionRoleOptions,
    roleReconciliationActions,
    roleReconciliationRuns,
    ticketPanels,
    verificationFlows,
    xpRoleRewards,
} from './schema.js';

export type DeletedGuildRoleReferenceCleanupSummary = {
    autoroleRulesDisabled: number;
    commandPermissionRulesUpdated: number;
    dashboardPermissionRulesUpdated: number;
    moderationPoliciesUpdated: number;
    reactionRoleAssignmentsRemoved: number;
    reactionRoleOptionsDeleted: number;
    ticketPanelsDisabled: number;
    ticketPanelsUpdated: number;
    verificationFlowsDisabled: number;
    xpRoleRewardsDeleted: number;
};

export type DeletedGuildRoleReferenceCleanupResult =
    | {
          status: 'cleaned';
          runId: string;
          summary: DeletedGuildRoleReferenceCleanupSummary;
      }
    | {
          status: 'unchanged';
          summary: DeletedGuildRoleReferenceCleanupSummary;
      };

const emptySummary: DeletedGuildRoleReferenceCleanupSummary = {
    autoroleRulesDisabled: 0,
    commandPermissionRulesUpdated: 0,
    dashboardPermissionRulesUpdated: 0,
    moderationPoliciesUpdated: 0,
    reactionRoleAssignmentsRemoved: 0,
    reactionRoleOptionsDeleted: 0,
    ticketPanelsDisabled: 0,
    ticketPanelsUpdated: 0,
    verificationFlowsDisabled: 0,
    xpRoleRewardsDeleted: 0,
};

export async function cleanupDeletedGuildRoleReferences(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; roleId: string; occurredAt?: Date }
): Promise<Result<DeletedGuildRoleReferenceCleanupResult, GuildFeatureRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const roleId = normalizeRequiredText(input.roleId, 'roleId');

    if (guildId.isErr()) return err(guildId.error);
    if (roleId.isErr()) return err(roleId.error);

    const updatedAt = input.occurredAt ?? new Date();

    try {
        const result = await db.transaction(async (tx) => {
            const summary = { ...emptySummary };

            summary.autoroleRulesDisabled = (
                await tx
                    .update(autoroleRules)
                    .set({ enabled: false, updatedAt })
                    .where(
                        and(
                            eq(autoroleRules.guildId, guildId.value),
                            eq(autoroleRules.roleId, roleId.value),
                            eq(autoroleRules.enabled, true)
                        )
                    )
                    .returning({ id: autoroleRules.id })
            ).length;

            const reactionOptions = await tx
                .select({ id: reactionRoleOptions.id })
                .from(reactionRoleOptions)
                .innerJoin(reactionRoleMessages, eq(reactionRoleMessages.id, reactionRoleOptions.reactionRoleMessageId))
                .where(
                    and(eq(reactionRoleMessages.guildId, guildId.value), eq(reactionRoleOptions.roleId, roleId.value))
                );

            if (reactionOptions.length > 0) {
                summary.reactionRoleOptionsDeleted = (
                    await tx
                        .delete(reactionRoleOptions)
                        .where(
                            inArray(
                                reactionRoleOptions.id,
                                reactionOptions.map((option) => option.id)
                            )
                        )
                        .returning({ id: reactionRoleOptions.id })
                ).length;
            }

            summary.reactionRoleAssignmentsRemoved = (
                await tx
                    .update(reactionRoleAssignments)
                    .set({ removedAt: updatedAt })
                    .where(
                        and(
                            eq(reactionRoleAssignments.guildId, guildId.value),
                            eq(reactionRoleAssignments.roleId, roleId.value),
                            isNull(reactionRoleAssignments.removedAt)
                        )
                    )
                    .returning({ id: reactionRoleAssignments.id })
            ).length;

            summary.verificationFlowsDisabled = (
                await tx
                    .update(verificationFlows)
                    .set({ enabled: false, updatedAt })
                    .where(
                        and(
                            eq(verificationFlows.guildId, guildId.value),
                            eq(verificationFlows.verifiedRoleId, roleId.value),
                            eq(verificationFlows.enabled, true)
                        )
                    )
                    .returning({ id: verificationFlows.id })
            ).length;

            summary.moderationPoliciesUpdated = await removeModerationProtectedRole(tx, {
                guildId: guildId.value,
                roleId: roleId.value,
                updatedAt,
            });
            const ticketPanelCleanup = await removeTicketPanelStaffRole(tx, {
                guildId: guildId.value,
                roleId: roleId.value,
                updatedAt,
            });
            summary.ticketPanelsUpdated = ticketPanelCleanup.updated;
            summary.ticketPanelsDisabled = ticketPanelCleanup.disabled;
            summary.commandPermissionRulesUpdated = await removeCommandPermissionRole(tx, {
                guildId: guildId.value,
                roleId: roleId.value,
                updatedAt,
            });
            summary.dashboardPermissionRulesUpdated = await removeDashboardPermissionRole(tx, {
                guildId: guildId.value,
                roleId: roleId.value,
                updatedAt,
            });
            summary.xpRoleRewardsDeleted = (
                await tx
                    .delete(xpRoleRewards)
                    .where(and(eq(xpRoleRewards.guildId, guildId.value), eq(xpRoleRewards.roleId, roleId.value)))
                    .returning({ id: xpRoleRewards.id })
            ).length;

            if (!hasCleanupChanges(summary)) {
                return { status: 'unchanged' as const, summary };
            }

            const runRows = await tx
                .insert(roleReconciliationRuns)
                .values({
                    guildId: guildId.value,
                    status: 'applied',
                    summary: {
                        event: 'role.deleted',
                        roleId: roleId.value,
                        ...summary,
                    },
                    updatedAt,
                })
                .returning({ id: roleReconciliationRuns.id });
            const run = runRows[0];

            if (!run) {
                throw new Error('Missing role cleanup run row.');
            }

            await tx.insert(roleReconciliationActions).values({
                runId: run.id,
                actionType: 'guild.role_deleted_references_cleaned',
                roleId: roleId.value,
                status: 'applied',
                details: summary,
                updatedAt,
            });

            return {
                status: 'cleaned' as const,
                runId: run.id,
                summary,
            };
        });

        return ok(result);
    } catch {
        return err({ type: 'database-error' });
    }
}

function hasCleanupChanges(summary: DeletedGuildRoleReferenceCleanupSummary): boolean {
    return Object.values(summary).some((count) => count > 0);
}

async function removeModerationProtectedRole(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; roleId: string; updatedAt: Date }
): Promise<number> {
    const rows = await db
        .select()
        .from(guildFeatureSettings)
        .where(and(eq(guildFeatureSettings.guildId, input.guildId), eq(guildFeatureSettings.feature, 'moderation')))
        .limit(1);
    const row = rows[0];
    const config = row ? toRecord(row.config) : undefined;
    const protectedRoleIds = readStringArray(config?.protectedRoleIds);

    if (!row || !config || !protectedRoleIds?.includes(input.roleId)) {
        return 0;
    }

    await db
        .update(guildFeatureSettings)
        .set({
            config: {
                ...config,
                protectedRoleIds: protectedRoleIds.filter((roleId) => roleId !== input.roleId),
            },
            updatedAt: input.updatedAt,
        })
        .where(eq(guildFeatureSettings.id, row.id));

    return 1;
}

async function removeTicketPanelStaffRole(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; roleId: string; updatedAt: Date }
): Promise<{ updated: number; disabled: number }> {
    const panels = await db.select().from(ticketPanels).where(eq(ticketPanels.guildId, input.guildId));
    let updated = 0;
    let disabled = 0;

    for (const panel of panels) {
        const config = toRecord(panel.config);
        const staffRoleIds = readStringArray(config?.staffRoleIds);

        if (!config || !staffRoleIds?.includes(input.roleId)) {
            continue;
        }

        const nextStaffRoleIds = staffRoleIds.filter((roleId) => roleId !== input.roleId);
        const shouldDisable = panel.enabled && config.privateTickets !== false && nextStaffRoleIds.length === 0;

        await db
            .update(ticketPanels)
            .set({
                config: {
                    ...config,
                    staffRoleIds: nextStaffRoleIds,
                },
                enabled: shouldDisable ? false : panel.enabled,
                updatedAt: input.updatedAt,
            })
            .where(eq(ticketPanels.id, panel.id));

        updated += 1;
        disabled += shouldDisable ? 1 : 0;
    }

    return { updated, disabled };
}

async function removeCommandPermissionRole(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; roleId: string; updatedAt: Date }
): Promise<number> {
    const rules = await db
        .select()
        .from(guildCommandPermissionRules)
        .where(eq(guildCommandPermissionRules.guildId, input.guildId));
    let updated = 0;

    for (const rule of rules) {
        if (!rule.roleIds.includes(input.roleId)) {
            continue;
        }

        await db
            .update(guildCommandPermissionRules)
            .set({
                roleIds: rule.roleIds.filter((roleId) => roleId !== input.roleId),
                updatedAt: input.updatedAt,
            })
            .where(eq(guildCommandPermissionRules.id, rule.id));
        updated += 1;
    }

    return updated;
}

async function removeDashboardPermissionRole(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; roleId: string; updatedAt: Date }
): Promise<number> {
    const rows = await db
        .select()
        .from(guildDashboardPermissionRules)
        .where(eq(guildDashboardPermissionRules.guildId, input.guildId))
        .limit(1);
    const row = rows[0];

    if (!row?.roleIds.includes(input.roleId)) {
        return 0;
    }

    await db
        .update(guildDashboardPermissionRules)
        .set({
            roleIds: row.roleIds.filter((roleId) => roleId !== input.roleId),
            updatedAt: input.updatedAt,
        })
        .where(eq(guildDashboardPermissionRules.guildId, input.guildId));

    return 1;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}
