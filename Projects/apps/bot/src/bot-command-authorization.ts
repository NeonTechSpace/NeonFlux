import { authorizeCommandAction, type DefconAudience, type DefconFeatureCategory } from '@neonflux/core/defcon';
import {
    findGuildCommandPermissionRule,
    findGuildSecurityPolicyByGuildId,
    listGuildDefconExemptionCategories,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext, BotMessageCreatedEvent } from './bot-feature-types.js';

export type AuthorizeBotCommandInput = {
    category: DefconFeatureCategory;
    audience: DefconAudience;
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
        input.audience === 'guarded'
            ? await findGuildCommandPermissionRule(context.db, {
                  guildId: event.guildId,
                  category: input.category,
              })
            : undefined;

    if (commandGrantResult?.isErr() === true && commandGrantResult.error !== 'not-found') {
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
        category: input.category,
        audience: input.audience,
        ...(commandGrantResult?.isOk() === true
            ? {
                  commandGrant: {
                      userIds: commandGrantResult.value.userIds,
                      roleIds: commandGrantResult.value.roleIds,
                  },
              }
            : {}),
        defconOneExemptCategories: exemptionCategoriesResult.value,
    });

    return ok(authorization.allowed);
}
