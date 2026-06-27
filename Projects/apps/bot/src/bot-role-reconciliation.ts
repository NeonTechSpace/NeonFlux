import {
    createRoleReconciliationRun,
    findRoleReconciliationSettingsByGuildId,
    findActiveVerificationRecord,
    listActiveReactionRoleAssignmentsByGuildUser,
    listEnabledAutoroleRulesByGuildId,
    listVerificationFlowsByGuildId,
    recordRoleReconciliationAction,
    updateRoleReconciliationRunStatus,
} from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { filterBotManageableRoleIds } from './bot-role-safety.js';

export type BotRoleReconciliationMemberEvent = {
    type: 'member.updated';
    guildId: string;
    userId: string;
    roleIds: readonly string[];
};

export type BotRoleReconciliationResult =
    | {
          status: 'applied';
          action: 'event.role_reconciliation.member_repaired';
          appliedRoleIds: string[];
      }
    | { status: 'ignored'; reason: 'bot-user-unavailable' | 'no-feature-handler' };

export async function reconcileMemberRoleState(
    context: BotFeatureHandlerContext,
    event: BotRoleReconciliationMemberEvent
): Promise<Result<BotRoleReconciliationResult, 'database-error' | 'platform-error'>> {
    const settingsResult = await findRoleReconciliationSettingsByGuildId(context.db, {
        guildId: event.guildId,
    });

    if (settingsResult.isErr()) {
        return err('database-error');
    }

    if (!settingsResult.value.enabled) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const desiredRoleSourcesResult = await collectDesiredRoleSources(context, event, settingsResult.value);

    if (desiredRoleSourcesResult.isErr()) {
        return err(desiredRoleSourcesResult.error);
    }

    const missingRoleIds = [...desiredRoleSourcesResult.value.keys()].filter(
        (roleId) => !event.roleIds.includes(roleId)
    );

    if (missingRoleIds.length === 0) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const safeRoleIdsResult = await filterBotManageableRoleIds(context, {
        guildId: event.guildId,
        roleIds: missingRoleIds,
    });

    if (safeRoleIdsResult.isErr() && safeRoleIdsResult.error === 'bot-user-unavailable') {
        return ok({ status: 'ignored', reason: 'bot-user-unavailable' });
    }

    if (safeRoleIdsResult.isErr()) {
        return err('platform-error');
    }

    if (safeRoleIdsResult.value.length === 0) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const runResult = await createRoleReconciliationRun(context.db, {
        guildId: event.guildId,
        summary: {
            userId: event.userId,
            missingRoleCount: missingRoleIds.length,
            repairableRoleCount: safeRoleIdsResult.value.length,
        },
    });

    if (runResult.isErr()) {
        return err('database-error');
    }

    const applyingResult = await updateRoleReconciliationRunStatus(context.db, {
        runId: runResult.value.id,
        status: 'applying',
        summary: runResult.value.summary,
    });

    if (applyingResult.isErr()) {
        return err('database-error');
    }

    return await applyMissingRoles(
        context,
        event,
        runResult.value.id,
        safeRoleIdsResult.value,
        desiredRoleSourcesResult.value
    );
}

async function collectDesiredRoleSources(
    context: BotFeatureHandlerContext,
    event: BotRoleReconciliationMemberEvent,
    settings: {
        restoreAutoroleRoles: boolean;
        restoreVerificationRoles: boolean;
        restoreReactionRoles: boolean;
    }
): Promise<Result<Map<string, Set<string>>, 'database-error'>> {
    const desiredRoleSources = new Map<string, Set<string>>();

    if (settings.restoreAutoroleRoles) {
        const autoroleResult = await listEnabledAutoroleRulesByGuildId(context.db, { guildId: event.guildId });

        if (autoroleResult.isErr()) {
            return err('database-error');
        }

        for (const rule of autoroleResult.value) {
            addDesiredRoleSource(desiredRoleSources, rule.roleId, 'autorole');
        }
    }

    if (settings.restoreVerificationRoles) {
        const verificationRecordResult = await findActiveVerificationRecord(context.db, {
            guildId: event.guildId,
            userId: event.userId,
        });

        if (verificationRecordResult.isErr() && verificationRecordResult.error.type !== 'not-found') {
            return err('database-error');
        }

        if (verificationRecordResult.isOk()) {
            const flowsResult = await listVerificationFlowsByGuildId(context.db, {
                guildId: event.guildId,
                enabled: true,
            });

            if (flowsResult.isErr()) {
                return err('database-error');
            }

            for (const flow of flowsResult.value) {
                addDesiredRoleSource(desiredRoleSources, flow.verifiedRoleId, 'verification');
            }
        }
    }

    if (settings.restoreReactionRoles) {
        const assignmentResult = await listActiveReactionRoleAssignmentsByGuildUser(context.db, {
            guildId: event.guildId,
            userId: event.userId,
        });

        if (assignmentResult.isErr()) {
            return err('database-error');
        }

        for (const assignment of assignmentResult.value) {
            addDesiredRoleSource(desiredRoleSources, assignment.roleId, 'reaction_roles');
        }
    }

    return ok(desiredRoleSources);
}

async function applyMissingRoles(
    context: BotFeatureHandlerContext,
    event: BotRoleReconciliationMemberEvent,
    runId: string,
    roleIds: readonly string[],
    desiredRoleSources: ReadonlyMap<string, ReadonlySet<string>>
): Promise<Result<BotRoleReconciliationResult, 'database-error' | 'platform-error'>> {
    const platform = createFluxerPlatform(context.client);
    const appliedRoleIds: string[] = [];

    for (const roleId of roleIds) {
        const addRoleResult = await platform.members.addRole({
            guildId: event.guildId,
            userId: event.userId,
            roleId,
        });

        if (addRoleResult.isErr()) {
            await recordRoleRepairAction(context, runId, event.userId, roleId, desiredRoleSources, 'failed');
            await updateRoleReconciliationRunStatus(context.db, {
                runId,
                status: 'failed',
                summary: { userId: event.userId, failedRoleId: roleId, appliedRoleIds },
            }).catch(() => undefined);
            return err('platform-error');
        }

        const actionResult = await recordRoleRepairAction(
            context,
            runId,
            event.userId,
            roleId,
            desiredRoleSources,
            'applied'
        );

        if (actionResult.isErr()) {
            return err('database-error');
        }

        appliedRoleIds.push(roleId);
    }

    const appliedResult = await updateRoleReconciliationRunStatus(context.db, {
        runId,
        status: 'applied',
        summary: { userId: event.userId, appliedRoleIds },
    });

    if (appliedResult.isErr()) {
        return err('database-error');
    }

    return ok({
        status: 'applied',
        action: 'event.role_reconciliation.member_repaired',
        appliedRoleIds,
    });
}

async function recordRoleRepairAction(
    context: BotFeatureHandlerContext,
    runId: string,
    userId: string,
    roleId: string,
    desiredRoleSources: ReadonlyMap<string, ReadonlySet<string>>,
    status: 'applied' | 'failed'
) {
    return recordRoleReconciliationAction(context.db, {
        runId,
        actionType: 'member.role_restored',
        roleId,
        status,
        details: {
            userId,
            sources: [...(desiredRoleSources.get(roleId) ?? [])],
        },
    });
}

function addDesiredRoleSource(roleSources: Map<string, Set<string>>, roleId: string, source: string): void {
    const sources = roleSources.get(roleId) ?? new Set<string>();
    sources.add(source);
    roleSources.set(roleId, sources);
}
