import {
    findEnabledReactionRoleOptionByReaction,
    listActiveReactionRoleAssignmentsByGuildMessageUser,
    markReactionRoleAssignmentRemoved,
    type ReactionRoleAssignmentRecord,
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
    userIsBot?: boolean;
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
    if (!event.guildId || event.userIsBot === true) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const guildId = event.guildId;
    const matchResult = await findEnabledReactionRoleOptionByReaction(context.db, {
        guildId,
        messageId: event.messageId,
        emojiKey: event.emojiKey,
    });

    if (matchResult.isErr()) {
        return matchResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    const roleId = matchResult.value.option.roleId;
    const safeRoleIdsResult = await filterBotManageableRoleIds(context, {
        guildId,
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
        if (matchResult.value.message.mode === 'exclusive') {
            const previousAssignmentsResult = await listActiveReactionRoleAssignmentsByGuildMessageUser(context.db, {
                guildId,
                messageId: event.messageId,
                userId: event.userId,
            });

            if (previousAssignmentsResult.isErr()) {
                return err('database-error');
            }

            const previousAssignments = previousAssignmentsResult.value.filter(
                (assignment) => assignment.roleId !== roleId
            );
            const previousRoleIds = [...new Set(previousAssignments.map((assignment) => assignment.roleId))];

            if (previousRoleIds.length > 0) {
                const safePreviousRoleIdsResult = await filterBotManageableRoleIds(context, {
                    guildId,
                    roleIds: previousRoleIds,
                });

                if (safePreviousRoleIdsResult.isErr()) {
                    return safePreviousRoleIdsResult.error === 'bot-user-unavailable'
                        ? ok({ status: 'ignored', reason: 'bot-user-unavailable' })
                        : err('platform-error');
                }

                if (safePreviousRoleIdsResult.value.length !== previousRoleIds.length) {
                    return err('platform-error');
                }

                const cleanupResult = await removeExclusiveReactionRoleAssignments(
                    context,
                    { ...event, guildId },
                    previousAssignments
                );

                if (cleanupResult.isErr()) {
                    return err(cleanupResult.error);
                }
            }
        }

        const addRoleResult = await platform.members.addRole({
            guildId,
            userId: event.userId,
            roleId,
        });

        if (addRoleResult.isErr()) {
            return err('platform-error');
        }

        const assignmentResult = await upsertReactionRoleAssignment(context.db, {
            guildId,
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
        guildId,
        userId: event.userId,
        roleId,
    });

    if (removeRoleResult.isErr()) {
        return err('platform-error');
    }

    const removalResult = await markReactionRoleAssignmentRemoved(context.db, {
        guildId,
        messageId: event.messageId,
        userId: event.userId,
        roleId,
    });

    if (removalResult.isErr() && removalResult.error.type !== 'not-found') {
        return err('database-error');
    }

    const reseedResult = await platform.messages.react({
        channelId: event.channelId,
        messageId: event.messageId,
        emoji: event.emojiKey,
    });

    if (reseedResult.isErr()) {
        return err('platform-error');
    }

    return ok({
        status: 'applied',
        action: 'event.reaction_roles.removed',
        roleId,
    });
}

async function removeExclusiveReactionRoleAssignments(
    context: BotFeatureHandlerContext,
    event: BotReactionRoleEvent & { guildId: string },
    assignments: ReactionRoleAssignmentRecord[]
): Promise<Result<void, 'database-error' | 'platform-error'>> {
    const platform = createFluxerPlatform(context.client);

    for (const assignment of assignments) {
        const removeRoleResult = await platform.members.removeRole({
            guildId: event.guildId,
            userId: event.userId,
            roleId: assignment.roleId,
        });

        if (removeRoleResult.isErr()) {
            return err('platform-error');
        }

        const removeReactionResult = await platform.messages.removeReaction({
            channelId: event.channelId,
            messageId: event.messageId,
            emoji: assignment.emojiKey,
            userId: event.userId,
        });

        if (removeReactionResult.isErr()) {
            return err('platform-error');
        }

        const removedAssignmentResult = await markReactionRoleAssignmentRemoved(context.db, {
            guildId: event.guildId,
            messageId: event.messageId,
            userId: event.userId,
            roleId: assignment.roleId,
        });

        if (removedAssignmentResult.isErr() && removedAssignmentResult.error.type !== 'not-found') {
            return err('database-error');
        }
    }

    return ok(undefined);
}
