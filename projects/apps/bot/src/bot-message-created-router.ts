import { err, ok, type Result } from 'neverthrow';

import { sendBotFeatureReply } from './bot-feature-replies.js';
import type {
    BotFeatureRoutingContext,
    BotFeatureRouteError,
    BotFeatureRouteHandledAction,
    BotFeatureRouteResult,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';
import { getHelpCommandIntent, routeHelpCommand } from './bot-help-command.js';
import {
    authorizeBotPresenceReply,
    getBotPresenceIntent,
    getBotPresenceReply,
    type BotPresenceIntent,
} from './bot-presence.js';
import { getMentionedPrefixCommand, routePrefixChangeCommand } from './bot-prefix-command.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';

export async function routeMessageCreatedEvent(
    context: BotFeatureRoutingContext,
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

    context.growthTelemetry.enqueue({
        authorIsBot: event.authorIsBot,
        guildId: event.guildId,
        messageId: event.messageId,
        occurredAt: event.createdAt,
        type: 'message.created',
    });

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
