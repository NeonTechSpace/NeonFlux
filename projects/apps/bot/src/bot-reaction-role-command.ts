import { DEFCON_FEATURE_CATEGORY } from '@neonflux/core/defcon';
import { listReactionRolePanelsByGuild, readReactionRolePanelByMessage } from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { authorizeBotCommand } from './bot-command-authorization.js';
import { sendBotFeatureReply } from './bot-feature-replies.js';
import type {
    BotFeatureRoutingContext,
    BotFeatureRouteError,
    BotFeatureRouteResult,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';
import { findEffectiveGuildCommandPrefix } from './guild-command-prefix.js';

export type ReactionRoleStatusIntent = { messageId?: string };

export async function getReactionRoleStatusIntent(
    context: BotFeatureRoutingContext,
    event: BotMessageCreatedEvent
): Promise<Result<ReactionRoleStatusIntent | undefined, 'database-error'>> {
    if (!event.guildId) return ok(undefined);
    const match = /^(.{1,3})rr\s+status(?:\s+(\S+))?\s*$/iu.exec(event.content.trim());
    if (!match) return ok(undefined);
    const prefix = await findEffectiveGuildCommandPrefix(context, event.guildId);
    if (prefix.isErr()) return err(prefix.error);
    if (match[1] !== prefix.value) return ok(undefined);
    return ok({ ...(match[2] ? { messageId: parseMessageId(match[2]) } : {}) });
}

export async function routeReactionRoleStatusCommand(
    context: BotFeatureRoutingContext,
    event: BotMessageCreatedEvent,
    intent: ReactionRoleStatusIntent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!event.guildId) return ok({ eventType: event.type, reason: 'guild-not-processable', status: 'ignored' });
    const authorization = await authorizeBotCommand(context, event, {
        audience: 'public',
        categoryId: 'reaction_roles',
        commandId: 'reaction_roles.status',
        defconCategory: DEFCON_FEATURE_CATEGORY.reactionRoles,
    });
    if (authorization.isErr()) return err(authorization.error);
    if (!authorization.value) return ok({ eventType: event.type, reason: 'defcon-denied', status: 'ignored' });

    if (intent.messageId) {
        const panel = await readReactionRolePanelByMessage(context.db, {
            guildId: event.guildId,
            messageId: intent.messageId,
        });
        if (panel.isErr()) return err('database-error');
        return sendBotFeatureReply(
            context,
            event,
            panel.value
                ? [
                      `Reaction roles: ${panel.value.name}`,
                      `Status: ${panel.value.status}`,
                      `Mode: ${panel.value.mode}`,
                      `Options: ${String(panel.value.desiredVersion.payload.options.length)}`,
                      ...(panel.value.errorCode ? [`Attention: ${panel.value.errorCode}`] : []),
                  ].join('\n')
                : 'That message is not managed by a reaction-role panel in this server.',
            'command.reaction_roles.status'
        );
    }

    const panels = await listReactionRolePanelsByGuild(context.db, { guildId: event.guildId });
    if (panels.isErr()) return err('database-error');
    const active = panels.value.filter((panel) => panel.status !== 'inactive');
    const needsAttention = panels.value.filter(
        (panel) => panel.status === 'degraded' || panel.status === 'unknown' || panel.errorCode
    );
    return sendBotFeatureReply(
        context,
        event,
        [
            'Reaction roles',
            `Configured: ${String(panels.value.length)}`,
            `Active or changing: ${String(active.length)}`,
            `Needs attention: ${String(needsAttention.length)}`,
            'Manage panels in Dashboard → Messaging → Reaction Roles.',
        ].join('\n'),
        'command.reaction_roles.status'
    );
}

function parseMessageId(value: string): string {
    try {
        const pathname = new URL(value).pathname;
        return pathname.split('/').filter(Boolean).at(-1) ?? value;
    } catch {
        return value;
    }
}
