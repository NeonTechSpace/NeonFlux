import { requestReactionRoleMemberTransition } from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { runNextReactionRoleMemberReconciliation } from './bot-reaction-role-member-reconciler.js';
import type { BotFeatureHandlerContext } from './bot-feature-types.js';

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
          action: 'event.reaction_roles.transition_queued';
      }
    | { status: 'ignored'; reason: 'no-feature-handler' };

export async function routeReactionRoleEvent(
    context: BotFeatureHandlerContext,
    event: BotReactionRoleEvent
): Promise<Result<BotReactionRoleResult, 'database-error' | 'platform-error'>> {
    if (!event.guildId || event.userIsBot === true) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const transition = await requestReactionRoleMemberTransition(context.db, {
        emojiKey: event.emojiKey,
        eventType: event.type === 'reaction.added' ? 'added' : 'removed',
        guildId: event.guildId,
        messageId: event.messageId,
        userId: event.userId,
    });
    if (transition.isErr()) return err('database-error');
    if (transition.value.type === 'ignored') {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    await runNextReactionRoleMemberReconciliation(context, {
        leaseOwner: `reaction-event:${event.guildId}:${event.messageId}:${event.userId}`,
    });
    return ok({ status: 'applied', action: 'event.reaction_roles.transition_queued' });
}
