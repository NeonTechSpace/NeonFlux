import { err, ok, type Result } from 'neverthrow';

import {
    recordBotInstallationEvent,
    removeBotInstallationEvent,
    type BotInstallationSyncResult,
} from './bot-installation-sync.js';
import type {
    BotFeatureEvent,
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteHandledAction,
    BotFeatureRouteResult,
} from './bot-feature-types.js';
import { trackGrowthOverviewEvent, type BotGrowthMemberEvent } from './bot-growth-tracking.js';
import { routeMessageCreatedEvent } from './bot-message-created-router.js';
import { routeReactionRoleEvent, routeReactionRoleMessageDeleted } from './bot-reaction-roles.js';
import { recordObservedStructureEvent } from './bot-structure-observer.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';

export type {
    BotFeatureEvent,
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteResult,
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
                    await removeBotInstallationEvent(context.db, context.mode, {
                        guildId: event.guildId,
                        ...(event.unavailable !== undefined ? { unavailable: event.unavailable } : {}),
                    }),
                    event.type
                );
            case 'member.joined':
                return await routeGrowthTrackingEvent(context, { ...event, type: 'member.joined' });
            case 'member.left':
                return await routeGrowthTrackingEvent(context, { ...event, type: 'member.left' });
            case 'message.created':
                return await routeMessageCreatedEvent(context, event);
            case 'reaction.added':
            case 'reaction.removed':
                return await routeReactionEvent(context, event);
            case 'guild.lifecycle.updated':
            case 'role.created':
            case 'role.updated':
            case 'role.deleted':
            case 'channel.created':
            case 'channel.updated':
            case 'channel.deleted':
                return await routeStructureEvent(context, event);
            case 'message.updated':
            case 'member.updated':
            case 'ban.added':
            case 'ban.removed':
            case 'voice_state.updated':
                return routeIgnoredEvent(context, event);
            case 'message.deleted':
                return await routeReactionRoleDeletedEvent(context, event);
        }
    } catch {
        return err('handler-error');
    }
}

async function routeReactionRoleDeletedEvent(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'message.deleted' }>
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({ eventType: event.type, status: 'ignored', reason: 'guild-not-processable' });
    }
    const result = await routeReactionRoleMessageDeleted(context, event);
    if (result.isErr()) return err(result.error);
    return result.value.status === 'applied'
        ? handledActionResult(event.type, result.value.action)
        : ok({ eventType: event.type, status: 'ignored', reason: result.value.reason });
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

async function routeReactionEvent(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'reaction.added' | 'reaction.removed' }>
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'guild-not-processable',
        });
    }

    const result = await routeReactionRoleEvent(context, event);

    if (result.isErr()) {
        return err(result.error);
    }

    if (result.value.status === 'applied') {
        return handledActionResult(event.type, result.value.action);
    }

    return ok({
        eventType: event.type,
        status: 'ignored',
        reason: result.value.reason,
    });
}

async function routeStructureEvent(
    context: BotFeatureHandlerContext,
    event: Extract<
        BotFeatureEvent,
        | { type: 'guild.lifecycle.updated' }
        | { type: 'role.created' | 'role.updated' | 'role.deleted' }
        | { type: 'channel.created' | 'channel.updated' | 'channel.deleted' }
    >
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'guild-not-processable',
        });
    }

    const result = await recordObservedStructureEvent(context, event);

    if (result.isErr()) {
        return err(result.error);
    }

    if (result.value.status === 'recorded') {
        return handledActionResult(event.type, result.value.action);
    }

    return ok({
        eventType: event.type,
        status: 'ignored',
        reason: result.value.reason,
    });
}

function routeIgnoredEvent(
    context: BotFeatureHandlerContext,
    event: BotFeatureEvent
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

function handledActionResult(
    eventType: BotFeatureEvent['type'],
    action: BotFeatureRouteHandledAction
): Result<BotFeatureRouteResult, BotFeatureRouteError> {
    return ok({
        eventType,
        status: 'handled',
        action,
    });
}
