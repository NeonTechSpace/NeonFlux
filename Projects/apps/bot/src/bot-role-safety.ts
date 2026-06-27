import { createFluxerPlatform } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';

export async function filterBotManageableRoleIds(
    context: BotFeatureHandlerContext,
    input: {
        guildId: string;
        roleIds: readonly string[];
    }
): Promise<Result<string[], 'bot-user-unavailable' | 'platform-error'>> {
    if (!context.botUserId) {
        return err('bot-user-unavailable');
    }

    const platform = createFluxerPlatform(context.client);
    const [structureResult, botMemberResult] = await Promise.all([
        platform.guildStructure.read({ guildId: input.guildId }),
        platform.members.read({ guildId: input.guildId, userId: context.botUserId }),
    ]);

    if (structureResult.isErr() || botMemberResult.isErr()) {
        return err('platform-error');
    }

    const roleById = new Map(structureResult.value.roles.map((role) => [role.id, role]));
    const botHighestRolePosition = Math.max(
        0,
        ...botMemberResult.value.roleIds.map((roleId) => roleById.get(roleId)?.position ?? 0)
    );

    return ok(
        input.roleIds.filter((roleId) => {
            const role = roleById.get(roleId);

            return Boolean(role && role.name !== '@everyone' && botHighestRolePosition > role.position);
        })
    );
}
