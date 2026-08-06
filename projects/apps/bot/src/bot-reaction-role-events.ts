import {
    markReactionRolePanelAggregateDrift,
    reconcileReactionRoleMemberRoles,
    recordReactionRoleReactionIntent,
    removeReactionRoleMemberState,
} from '@neonflux/db';
import { createFluxerReactionRolePlatform } from '@neonflux/fluxer';
import { getReactionRoleEmojiKey, type ReactionRoleEmoji } from '@neonflux/reaction-roles';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';
import { reactionRolesAllowed } from './bot-reaction-role-policy.js';

export type BotReactionRoleEvent =
    | {
          channelId: string;
          emoji: ReactionRoleEmoji;
          guildId: string | null;
          messageId: string;
          selected: boolean;
          type: 'reaction';
          userId: string;
          userIsBot: boolean;
      }
    | {
          emoji?: ReactionRoleEmoji;
          guildId: string | null;
          messageId: string;
          type: 'all-reactions-removed' | 'emoji-removed' | 'message-deleted';
      }
    | { guildId: string; roleIds: string[]; type: 'member-roles-changed'; userId: string }
    | { guildId: string; type: 'member-left'; userId: string };

export async function handleBotReactionRoleEvent(
    context: BotFeatureHandlerContext,
    event: BotReactionRoleEvent
): Promise<'handled' | 'ignored'> {
    if (!event.guildId) {
        if (event.type !== 'message-deleted') return 'ignored';
        const marked = await markReactionRolePanelAggregateDrift(context.db, {
            messageId: event.messageId,
            type: event.type,
        });
        if (marked.isErr()) context.logger.warn('reaction_roles.aggregate_drift_persistence_failed');
        return marked.isOk() && marked.value ? 'handled' : 'ignored';
    }
    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) return 'ignored';
    if (event.type === 'member-left') {
        const removed = await removeReactionRoleMemberState(context.db, event);
        if (removed.isErr())
            context.logger.warn('reaction_roles.member_state_removal_failed', { guildId: event.guildId });
        return removed.isOk() ? 'handled' : 'ignored';
    }
    if (event.type === 'member-roles-changed') {
        const reconciled = await reconcileReactionRoleMemberRoles(context.db, event);
        return reconciled.isOk() && reconciled.value > 0 ? 'handled' : 'ignored';
    }
    if (event.type !== 'reaction') {
        const type = event.type;
        const marked = await markReactionRolePanelAggregateDrift(context.db, {
            ...(event.emoji ? { emojiKey: getReactionRoleEmojiKey(event.emoji) } : {}),
            guildId: event.guildId,
            messageId: event.messageId,
            type,
        });
        if (marked.isErr()) {
            context.logger.warn('reaction_roles.aggregate_drift_persistence_failed', { guildId: event.guildId });
        }
        return marked.isOk() && marked.value ? 'handled' : 'ignored';
    }
    if (event.userIsBot && (event.userId !== context.botUserId || event.selected)) return 'ignored';
    if (!(await reactionRolesAllowed(context, event.guildId))) return 'ignored';
    const intent = await recordReactionRoleReactionIntent(context.db, {
        channelId: event.channelId,
        emoji: event.emoji,
        guildId: event.guildId,
        messageId: event.messageId,
        selected: event.selected,
        userId: event.userId,
        userIsBot: event.userId === context.botUserId,
    });
    if (intent.isErr()) {
        context.logger.warn('reaction_roles.intent_persistence_failed', { guildId: event.guildId });
        return 'ignored';
    }
    if (intent.value.type === 'ignored') return 'ignored';
    const platform = createFluxerReactionRolePlatform(context.client);
    if (intent.value.type === 'unconfigured' && event.selected) {
        await platform.removeUserReaction({
            channelId: event.channelId,
            emoji: event.emoji,
            messageId: event.messageId,
            userId: event.userId,
        });
    } else if (intent.value.type === 'seed-repair') {
        await platform.react({
            channelId: event.channelId,
            emoji: intent.value.emoji,
            messageId: event.messageId,
        });
    }
    return 'handled';
}
