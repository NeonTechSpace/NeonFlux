import { err, ok, type Result } from 'neverthrow';

import {
    recordBotInstallationEvent,
    removeBotInstallationEvent,
    type BotInstallationSyncResult,
} from './bot-installation-sync.js';
import type {
    BotFeatureEvent,
    BotFeatureHandlerContext,
    BotFeatureRoutingContext,
    BotFeatureRouteError,
    BotFeatureRouteHandledAction,
    BotFeatureRouteResult,
} from './bot-feature-types.js';
import { routeMessageCreatedEvent } from './bot-message-created-router.js';
import { recordObservedStructureEvent } from './bot-structure-observer.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';

export type {
    BotFeatureEvent,
    BotFeatureRoutingContext,
    BotFeatureRouteError,
    BotFeatureRouteResult,
} from './bot-feature-types.js';

export async function routeBotFeatureEvent(
    context: BotFeatureRoutingContext,
    event: BotFeatureEvent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    try {
        switch (event.type) {
            case 'guild.lifecycle.created':
            case 'guild.lifecycle.available':
                return mapInstallationSyncResult(
                    await recordBotInstallationEvent(context.db, context.mode, { guildId: event.guildId }),
                    event.type
                );
            case 'guild.lifecycle.deleted':
                return mapInstallationSyncResult(
                    await removeBotInstallationEvent(context.db, context.mode, { guildId: event.guildId }),
                    event.type
                );
            case 'guild.lifecycle.unavailable':
                return routeIgnoredEvent(context, event);
            case 'member.joined':
                return routeGrowthTrackingEvent(context, event);
            case 'member.left':
                return routeGrowthTrackingEvent(context, event);
            case 'message.created':
                return await routeMessageCreatedEvent(context, event);
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
        }
    } catch {
        return err('handler-error');
    }
}

function routeGrowthTrackingEvent(
    context: BotFeatureRoutingContext,
    event: Extract<BotFeatureEvent, { type: 'member.joined' | 'member.left' }>
): Result<BotFeatureRouteResult, BotFeatureRouteError> {
    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'guild-not-processable',
        });
    }

    const admission = context.growthTelemetry.enqueue(
        event.type === 'member.joined'
            ? {
                  guildId: event.guildId,
                  membershipStartedAt: event.joinedAt,
                  type: event.type,
                  userId: event.userId,
              }
            : { guildId: event.guildId, type: event.type, userId: event.userId }
    );

    if (admission !== 'accepted') {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: admission === 'overloaded' ? 'telemetry-overloaded' : 'telemetry-stopped',
        });
    }

    return ok({
        eventType: event.type,
        status: 'handled',
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
