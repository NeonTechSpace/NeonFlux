import { requestReactionRoleExternalMessageDeleted, requestReactionRoleMemberTransition } from '@neonflux/db';
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
          action: 'event.reaction_roles.transition_queued' | 'event.reaction_roles.external_delete_cleanup_queued';
      }
    | { status: 'ignored'; reason: 'no-feature-handler' };

const transitionTails = new Map<string, Promise<void>>();

export async function routeReactionRoleEvent(
    context: BotFeatureHandlerContext,
    event: BotReactionRoleEvent
): Promise<Result<BotReactionRoleResult, 'database-error' | 'platform-error'>> {
    if (!event.guildId || event.userIsBot === true) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }
    const guildId = event.guildId;

    const transition = await serializeTransition(event, () =>
        requestReactionRoleMemberTransition(context.db, {
            emojiKey: event.emojiKey,
            eventType: event.type === 'reaction.added' ? 'added' : 'removed',
            guildId,
            messageId: event.messageId,
            userId: event.userId,
        })
    );
    if (transition.isErr()) return err('database-error');
    if (transition.value.type === 'ignored') {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    await runNextReactionRoleMemberReconciliation(context, {
        leaseOwner: `reaction-event:${guildId}:${event.messageId}:${event.userId}`,
    });
    return ok({ status: 'applied', action: 'event.reaction_roles.transition_queued' });
}

export async function routeReactionRoleMessageDeleted(
    context: BotFeatureHandlerContext,
    event: { guildId: string | null; messageId: string }
): Promise<Result<BotReactionRoleResult, 'database-error' | 'platform-error'>> {
    if (!event.guildId) return ok({ status: 'ignored', reason: 'no-feature-handler' });
    const requested = await requestReactionRoleExternalMessageDeleted(context.db, {
        guildId: event.guildId,
        messageId: event.messageId,
    });
    if (requested.isErr()) return err('database-error');
    if (!requested.value) return ok({ status: 'ignored', reason: 'no-feature-handler' });
    return ok({ status: 'applied', action: 'event.reaction_roles.external_delete_cleanup_queued' });
}

async function serializeTransition<T>(event: BotReactionRoleEvent, work: () => Promise<T>): Promise<T> {
    const key = `${event.guildId ?? ''}:${event.messageId}:${event.userId}`;
    const previous = transitionTails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(work);
    const tail = result.then(
        () => undefined,
        () => undefined
    );
    transitionTails.set(key, tail);
    try {
        return await result;
    } finally {
        if (transitionTails.get(key) === tail) transitionTails.delete(key);
    }
}
