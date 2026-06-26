import { err, ok, type Result } from 'neverthrow';

import {
    recordBotInstallationEvent,
    removeBotInstallationEvent,
    type BotInstallationSyncResult,
} from './bot-installation-sync.js';
import { sendBotFeatureReply } from './bot-feature-replies.js';
import type {
    BotFeatureEvent,
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteHandledAction,
    BotFeatureRouteResult,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';
import { getHelpCommandIntent, routeHelpCommand } from './bot-help-command.js';
import { trackGrowthOverviewEvent, type BotGrowthMemberEvent } from './bot-growth-tracking.js';
import {
    authorizeBotPresenceReply,
    getBotPresenceIntent,
    getBotPresenceReply,
    type BotPresenceIntent,
} from './bot-presence.js';
import { getMentionedPrefixCommand, routePrefixChangeCommand } from './bot-prefix-command.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';

export type {
    BotFeatureEvent,
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteIgnoredReason,
    BotFeatureRouteResult,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';

export async function routeBotFeatureEvent(
    context: BotFeatureHandlerContext,
    event: BotFeatureEvent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    try {
        switch (event.type) {
            case 'guild.lifecycle.created':
                return mapInstallationSyncResult(
                    await recordBotInstallationEvent(context.db, context.mode, { guildId: event.guildId }),
                    event.type
                );
            case 'guild.lifecycle.deleted':
                return mapInstallationSyncResult(
                    await removeBotInstallationEvent(context.db, context.mode, { guildId: event.guildId }),
                    event.type
                );
            case 'guild.lifecycle.updated':
            case 'message.updated':
            case 'message.deleted':
            case 'reaction.added':
            case 'reaction.removed':
                return routeScaffoldEvent(context, event);
            case 'member.joined':
                return await routeGrowthTrackingEvent(context, { ...event, type: 'member.joined' });
            case 'member.left':
                return await routeGrowthTrackingEvent(context, { ...event, type: 'member.left' });
            case 'member.updated':
            case 'ban.added':
            case 'ban.removed':
            case 'role.created':
            case 'role.updated':
            case 'role.deleted':
            case 'channel.created':
            case 'channel.updated':
            case 'channel.deleted':
            case 'voice_state.updated':
                return routeScaffoldEvent(context, event);
            case 'message.created':
                return await routeMessageCreatedEvent(context, event);
        }
    } catch {
        return err('handler-error');
    }
}

async function routeGrowthTrackingEvent(
    context: BotFeatureHandlerContext,
    event: BotGrowthMemberEvent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const result = await trackGrowthOverviewEvent(context, event);

    if (result.isErr()) {
        return err(result.error);
    }

    if (result.value.status === 'ignored') {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: result.value.reason,
        });
    }

    return ok({
        eventType: event.type,
        status: 'handled',
    });
}

function mapInstallationSyncResult(
    result: Result<BotInstallationSyncResult, 'database-error'>,
    eventType: BotFeatureEvent['type']
): Result<BotFeatureRouteResult, BotFeatureRouteError> {
    if (result.isErr()) {
        return err(result.error);
    }

    switch (result.value.status) {
        case 'recorded':
        case 'removed':
            return ok({
                eventType,
                status: 'handled',
            });
        case 'ignored':
            return ok({
                eventType,
                status: 'ignored',
            });
    }
}

function routeScaffoldEvent(
    context: BotFeatureHandlerContext,
    event: Exclude<BotFeatureEvent, { type: 'guild.lifecycle.created' | 'guild.lifecycle.deleted' | 'message.created' }>
): Result<BotFeatureRouteResult, BotFeatureRouteError> {
    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'guild-not-processable',
        });
    }

    return ok({
        eventType: event.type,
        status: 'ignored',
        reason: 'no-feature-handler',
    });
}

async function routeMessageCreatedEvent(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (event.authorIsBot) {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'bot-authored-message',
        });
    }

    const prefixChangeCommand = getMentionedPrefixCommand(context, event);

    if (prefixChangeCommand && !event.guildId) {
        return await routePrefixChangeCommand(context, event, prefixChangeCommand.rawPrefix);
    }

    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'guild-not-processable',
        });
    }

    await trackGrowthOverviewEvent(context, event).catch(() => undefined);

    if (prefixChangeCommand) {
        return await routePrefixChangeCommand(context, event, prefixChangeCommand.rawPrefix);
    }

    const helpIntentResult = await getHelpCommandIntent(context, event);

    if (helpIntentResult.isErr()) {
        return err(helpIntentResult.error);
    }

    if (helpIntentResult.value) {
        return await routeHelpCommand(context, event, helpIntentResult.value);
    }

    const intentResult = await getBotPresenceIntent(context, event);

    if (intentResult.isErr()) {
        return err(intentResult.error);
    }

    const intent = intentResult.value;

    if (intent.type === 'ignored') {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: intent.reason,
        });
    }

    if (intent.type === 'prefix-change-command') {
        return await routePrefixChangeCommand(context, event, intent.rawPrefix);
    }

    const authorizationResult = await authorizeBotPresenceReply(context, event);

    if (authorizationResult.isErr()) {
        return err(authorizationResult.error);
    }

    if (!authorizationResult.value) {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'defcon-denied',
        });
    }

    return sendBotFeatureReply(context, event, getBotPresenceReply(event, intent), getPresenceHandledAction(intent));
}

function getPresenceHandledAction(intent: BotPresenceIntent): BotFeatureRouteHandledAction {
    switch (intent.type) {
        case 'ping-command':
            return 'command.ping';
        case 'contextless-mention':
            return 'bot_mention.contextless_reply';
        case 'ignored':
        case 'prefix-change-command':
            throw new Error(`Cannot create a handled action for intent: ${intent.type}`);
    }
}
