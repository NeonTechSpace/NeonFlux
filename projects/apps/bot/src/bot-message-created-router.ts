import { err, ok, type Result } from 'neverthrow';

import { routeAutomodMessageEvent } from './bot-automod.js';
import { sendBotFeatureReply } from './bot-feature-replies.js';
import type {
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteHandledAction,
    BotFeatureRouteResult,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';
import { getHelpCommandIntent, routeHelpCommand } from './bot-help-command.js';
import { trackGrowthOverviewEvent } from './bot-growth-tracking.js';
import { getModerationCommandIntent, routeModerationCommand } from './bot-moderation-command.js';
import {
    authorizeBotPresenceReply,
    getBotPresenceIntent,
    getBotPresenceReply,
    type BotPresenceIntent,
} from './bot-presence.js';
import { getMentionedPrefixCommand, routePrefixChangeCommand } from './bot-prefix-command.js';
import { getSuggestionCommandIntent, routeSuggestionCommand } from './bot-suggestions.js';
import { handleVcGeneratorControlResponse } from './bot-vc-generator.js';
import { getXpCommandIntent, routeXpCommand, trackXpMessageActivity } from './bot-xp.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';

export async function routeMessageCreatedEvent(
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

    const vcGeneratorControlResult = await handleVcGeneratorControlResponse(context, event);

    if (vcGeneratorControlResult.isErr()) {
        return err(vcGeneratorControlResult.error);
    }

    if (vcGeneratorControlResult.value.status === 'applied') {
        return handledActionResult(event.type, vcGeneratorControlResult.value.action);
    }

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

    const xpIntentResult = await getXpCommandIntent(context, event);

    if (xpIntentResult.isErr()) {
        return err(xpIntentResult.error);
    }

    if (xpIntentResult.value) {
        return await routeXpCommand(context, event, xpIntentResult.value);
    }

    const moderationIntentResult = await getModerationCommandIntent(context, event);

    if (moderationIntentResult.isErr()) {
        return err(moderationIntentResult.error);
    }

    if (moderationIntentResult.value) {
        return await routeModerationCommand(context, event, moderationIntentResult.value);
    }

    const suggestionIntentResult = await getSuggestionCommandIntent(context, event);

    if (suggestionIntentResult.isErr()) {
        return err(suggestionIntentResult.error);
    }

    if (suggestionIntentResult.value) {
        return await routeSuggestionCommand(context, event, suggestionIntentResult.value);
    }

    const intentResult = await getBotPresenceIntent(context, event);

    if (intentResult.isErr()) {
        return err(intentResult.error);
    }

    const intent = intentResult.value;

    if (intent.type === 'ignored') {
        const xpResult = await trackXpMessageActivity(context, event);

        if (xpResult.isErr()) {
            return err(xpResult.error);
        }

        const automodResult = await routeAutomodMessageEvent(context, event);

        if (automodResult.isErr()) {
            return err(automodResult.error);
        }

        if (
            automodResult.value.status === 'recorded' ||
            automodResult.value.status === 'enforced' ||
            automodResult.value.status === 'enforcement-failed'
        ) {
            return ok({
                eventType: event.type,
                status: 'handled',
                action: automodResult.value.action,
            });
        }

        if (xpResult.value.status === 'awarded') {
            return ok({
                eventType: event.type,
                status: 'handled',
                action: xpResult.value.action,
            });
        }

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

function handledActionResult(
    eventType: BotMessageCreatedEvent['type'],
    action: BotFeatureRouteHandledAction
): Result<BotFeatureRouteResult, BotFeatureRouteError> {
    return ok({
        eventType,
        status: 'handled',
        action,
    });
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
