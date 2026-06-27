import { listEnabledAutoroleRulesByGuildId } from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { filterBotManageableRoleIds } from './bot-role-safety.js';

export type BotAutoroleMemberJoinEvent = {
    type: 'member.joined';
    guildId: string;
    userId: string;
    roleIds: readonly string[];
};

export type BotAutoroleResult =
    | { status: 'applied'; action: 'event.autorole.member_joined'; appliedRoleIds: string[] }
    | { status: 'ignored'; reason: 'bot-user-unavailable' | 'no-feature-handler' };

export async function applyAutoroleOnMemberJoin(
    context: BotFeatureHandlerContext,
    event: BotAutoroleMemberJoinEvent
): Promise<Result<BotAutoroleResult, 'database-error' | 'platform-error'>> {
    const rulesResult = await listEnabledAutoroleRulesByGuildId(context.db, {
        guildId: event.guildId,
    });

    if (rulesResult.isErr()) {
        return err('database-error');
    }

    const roleIdsToApply = rulesResult.value
        .map((rule) => rule.roleId)
        .filter((roleId) => !event.roleIds.includes(roleId));

    if (roleIdsToApply.length === 0) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const safeRoleIdsResult = await filterBotManageableRoleIds(context, {
        guildId: event.guildId,
        roleIds: roleIdsToApply,
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

    const platform = createFluxerPlatform(context.client);
    const appliedRoleIds: string[] = [];

    for (const roleId of safeRoleIdsResult.value) {
        const addRoleResult = await platform.members.addRole({
            guildId: event.guildId,
            userId: event.userId,
            roleId,
        });

        if (addRoleResult.isErr()) {
            return err('platform-error');
        }

        appliedRoleIds.push(roleId);
    }

    return ok({
        status: 'applied',
        action: 'event.autorole.member_joined',
        appliedRoleIds,
    });
}
