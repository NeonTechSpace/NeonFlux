import {
    findEnabledReactionRoleOptionByReaction,
    markReactionRoleAssignmentRemoved,
    upsertReactionRoleAssignment,
} from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { filterBotManageableRoleIds } from './bot-role-safety.js';

export type BotReactionRoleEvent = {
    type: 'reaction.added' | 'reaction.removed';
    guildId: string | null;
    messageId: string;
    channelId: string;
    userId: string;
    emojiKey: string;
};

export type BotReactionRoleResult =
    | {
          status: 'applied';
          action: 'event.reaction_roles.assigned' | 'event.reaction_roles.removed';
          roleId: string;
      }
    | { status: 'ignored'; reason: 'bot-user-unavailable' | 'no-feature-handler' };

export async function routeReactionRoleEvent(
    context: BotFeatureHandlerContext,
    event: BotReactionRoleEvent
): Promise<Result<BotReactionRoleResult, 'database-error' | 'platform-error'>> {
    if (!event.guildId) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const matchResult = await findEnabledReactionRoleOptionByReaction(context.db, {
        guildId: event.guildId,
        messageId: event.messageId,
        emojiKey: event.emojiKey,
    });

    if (matchResult.isErr()) {
        return matchResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    if (event.type === 'reaction.removed' && !matchResult.value.message.removeOnUnreact) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const roleId = matchResult.value.option.roleId;
    const safeRoleIdsResult = await filterBotManageableRoleIds(context, {
        guildId: event.guildId,
        roleIds: [roleId],
    });

    if (safeRoleIdsResult.isErr() && safeRoleIdsResult.error === 'bot-user-unavailable') {
        return ok({ status: 'ignored', reason: 'bot-user-unavailable' });
    }

    if (safeRoleIdsResult.isErr()) {
        return err('platform-error');
    }

    if (!safeRoleIdsResult.value.includes(roleId)) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const platform = createFluxerPlatform(context.client);

    if (event.type === 'reaction.added') {
        const addRoleResult = await platform.members.addRole({
            guildId: event.guildId,
            userId: event.userId,
            roleId,
        });

        if (addRoleResult.isErr()) {
            return err('platform-error');
        }

        const assignmentResult = await upsertReactionRoleAssignment(context.db, {
            guildId: event.guildId,
            messageId: event.messageId,
            userId: event.userId,
            roleId,
            emojiKey: event.emojiKey,
        });

        if (assignmentResult.isErr()) {
            return err('database-error');
        }

        return ok({
            status: 'applied',
            action: 'event.reaction_roles.assigned',
            roleId,
        });
    }

    const removeRoleResult = await platform.members.removeRole({
        guildId: event.guildId,
        userId: event.userId,
        roleId,
    });

    if (removeRoleResult.isErr()) {
        return err('platform-error');
    }

    const removalResult = await markReactionRoleAssignmentRemoved(context.db, {
        guildId: event.guildId,
        messageId: event.messageId,
        userId: event.userId,
        roleId,
    });

    if (removalResult.isErr() && removalResult.error.type !== 'not-found') {
        return err('database-error');
    }

    return ok({
        status: 'applied',
        action: 'event.reaction_roles.removed',
        roleId,
    });
}
