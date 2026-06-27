import {
    authorizeCommandAction,
    type DefconAudience,
    type DefconFeatureCategory,
    type DefconGrantRule,
} from '@neonflux/core/defcon';
import {
    findGuildCommandPermissionRule,
    findGuildSecurityPolicyByGuildId,
    listGuildDefconExemptionCategories,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext, BotMessageCreatedEvent } from './bot-feature-types.js';

export type AuthorizeBotCommandInput = {
    commandId: string;
    categoryId: string;
    defconCategory: DefconFeatureCategory;
    audience: DefconAudience;
};

type MutableDefconGrantRule = {
    userIds: string[];
    roleIds: string[];
};

export async function authorizeBotCommand(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    input: AuthorizeBotCommandInput
): Promise<Result<boolean, 'database-error'>> {
    if (!event.guildId) {
        return ok(false);
    }

    const securityPolicyResult = await findGuildSecurityPolicyByGuildId(context.db, { guildId: event.guildId });

    if (securityPolicyResult.isErr() && securityPolicyResult.error !== 'not-found') {
        return err('database-error');
    }

    const commandGrantResult =
        input.audience === 'guarded' ? await loadBotCommandGrant(context, event.guildId, input) : ok(undefined);

    if (commandGrantResult.isErr()) {
        return err('database-error');
    }

    const exemptionCategoriesResult =
        input.audience === 'public'
            ? await listGuildDefconExemptionCategories(context.db, { guildId: event.guildId })
            : ok([]);

    if (exemptionCategoriesResult.isErr()) {
        return err('database-error');
    }

    const storedLevel = securityPolicyResult.isOk() ? securityPolicyResult.value.defconLevel : undefined;
    const authorization = authorizeCommandAction({
        appEnv: context.appEnv,
        override: context.guildDefconOverride,
        ...(storedLevel ? { storedLevel } : {}),
        actor: {
            userId: event.authorId,
            roleIds: event.authorRoleIds,
            isServerOwner: event.authorIsServerOwner,
            hasManageServer: event.authorHasManageServer,
        },
        category: input.defconCategory,
        audience: input.audience,
        ...(commandGrantResult.value
            ? {
                  commandGrant: commandGrantResult.value,
              }
            : {}),
        defconOneExemptCategories: exemptionCategoriesResult.value,
    });

    return ok(authorization.allowed);
}

async function loadBotCommandGrant(
    context: BotFeatureHandlerContext,
    guildId: string,
    input: AuthorizeBotCommandInput
): Promise<Result<DefconGrantRule | undefined, 'database-error'>> {
    const targetLookups = [
        { targetType: 'command' as const, targetId: input.commandId },
        { targetType: 'category' as const, targetId: input.categoryId },
        ...(input.defconCategory !== input.categoryId
            ? [{ targetType: 'category' as const, targetId: input.defconCategory }]
            : []),
    ];
    const grant: MutableDefconGrantRule = {
        userIds: [],
        roleIds: [],
    };

    for (const target of targetLookups) {
        const result = await findGuildCommandPermissionRule(context.db, {
            guildId,
            targetType: target.targetType,
            targetId: target.targetId,
        });

        if (result.isErr()) {
            if (result.error === 'not-found') {
                continue;
            }

            return err('database-error');
        }

        grant.userIds.push(...result.value.userIds);
        grant.roleIds.push(...result.value.roleIds);
    }

    return grant.userIds.length > 0 || grant.roleIds.length > 0 ? ok(deduplicateGrant(grant)) : ok(undefined);
}

function deduplicateGrant(grant: MutableDefconGrantRule): DefconGrantRule {
    return {
        userIds: [...new Set(grant.userIds)],
        roleIds: [...new Set(grant.roleIds)],
    };
}
