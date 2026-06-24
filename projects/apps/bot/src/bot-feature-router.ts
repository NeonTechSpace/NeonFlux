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
import {
    authorizeBotPresenceReply,
    getBotPresenceIntent,
    getBotPresenceReply,
    type BotPresenceIntent,
} from './bot-presence.js';
import { routePrefixChangeCommand } from './bot-prefix-command.js';

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
            case 'message.created':
                return await routeMessageCreatedEvent(context, event);
        }
    } catch {
        return err('handler-error');
    }
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

async function routeMessageCreatedEvent(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
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
