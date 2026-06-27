import { err, ok, type Result } from 'neverthrow';

import {
    recordBotInstallationEvent,
    removeBotInstallationEvent,
    type BotInstallationSyncResult,
} from './bot-installation-sync.js';
import { applyAutoroleOnMemberJoin } from './bot-autorole.js';
import type {
    BotFeatureEvent,
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteHandledAction,
    BotFeatureRouteResult,
} from './bot-feature-types.js';
import { routeGiveawayReactionEvent } from './bot-giveaways.js';
import { trackGrowthOverviewEvent, type BotGrowthMemberEvent } from './bot-growth-tracking.js';
import { routeMessageCreatedEvent } from './bot-message-created-router.js';
import { reconcileModerationBanEvent, type BotModerationBanEvent } from './bot-moderation-event-reconciliation.js';
import { routeReactionRoleEvent } from './bot-reaction-roles.js';
import { reconcileMemberRoleState } from './bot-role-reconciliation.js';
import { cleanupDeletedRoleReferences } from './bot-role-reference-cleanup.js';
import { logServerEvent } from './bot-server-event-logging.js';
import { recordObservedStructureEvent } from './bot-structure-observer.js';
import { routeSuggestionReactionEvent } from './bot-suggestions.js';
import { routeTicketChannelDeletedEvent, routeTicketReactionEvent } from './bot-tickets.js';
import { applyVerificationReaction, restoreVerificationOnMemberJoin } from './bot-verification.js';
import {
    handleVcGeneratorReactionControl,
    handleVcGeneratorVoiceStateUpdate,
    markVcGeneratorChannelDeleted,
} from './bot-vc-generator.js';
import { cleanupEmptyGeneratedVoiceChannelAfterVoiceStateUpdate } from './bot-vc-generator-cleanup.js';
import { trackXpVoiceStateUpdate } from './bot-xp.js';
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
                return await routeScaffoldEvent(context, event);
            case 'member.joined':
                return await routeGrowthTrackingEvent(context, { ...event, type: 'member.joined' });
            case 'member.left':
                return await routeGrowthTrackingEvent(context, { ...event, type: 'member.left' });
            case 'member.updated':
                return await routeScaffoldEvent(context, event);
            case 'ban.added':
            case 'ban.removed':
                return await routeModerationBanEvent(context, event);
            case 'role.created':
            case 'role.updated':
            case 'role.deleted':
            case 'channel.created':
            case 'channel.updated':
            case 'channel.deleted':
                return await routeScaffoldEvent(context, event);
            case 'voice_state.updated':
                return await routeVoiceStateEvent(context, event);
            case 'message.created':
                return await routeMessageCreatedEvent(context, event);
        }
    } catch {
        return err('handler-error');
    }
}

async function routeModerationBanEvent(
    context: BotFeatureHandlerContext,
    event: BotModerationBanEvent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'guild-not-processable',
        });
    }

    const result = await reconcileModerationBanEvent(context, event);

    if (result.isErr()) {
        return err(result.error);
    }

    const loggingResult = await logServerEvent(context, event);

    if (loggingResult.isErr()) {
        return err(loggingResult.error);
    }

    return ok({
        eventType: event.type,
        status: result.value.status,
        action: result.value.action,
    });
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

    let handledAction: BotFeatureRouteHandledAction | undefined;

    if (event.type === 'member.joined') {
        const autoroleResult = await applyAutoroleOnMemberJoin(context, event);

        if (autoroleResult.isErr()) {
            return err(autoroleResult.error);
        }

        if (autoroleResult.value.status === 'applied') {
            handledAction = autoroleResult.value.action;
        }

        const verificationResult = await restoreVerificationOnMemberJoin(context, event);

        if (verificationResult.isErr()) {
            return err(verificationResult.error);
        }

        if (!handledAction && verificationResult.value.status === 'applied') {
            handledAction = verificationResult.value.action;
        }
    }

    const loggingResult = await logServerEvent(context, event);

    if (loggingResult.isErr()) {
        return err(loggingResult.error);
    }

    return ok({
        eventType: event.type,
        status: 'handled',
        ...(handledAction
            ? { action: handledAction }
            : loggingResult.value.status === 'logged'
              ? { action: loggingResult.value.action }
              : {}),
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

async function routeScaffoldEvent(
    context: BotFeatureHandlerContext,
    event: Exclude<BotFeatureEvent, { type: 'guild.lifecycle.created' | 'guild.lifecycle.deleted' | 'message.created' }>
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'guild-not-processable',
        });
    }

    let handledAction: BotFeatureRouteHandledAction | undefined;

    if (event.type === 'member.updated') {
        const reconciliationResult = await reconcileMemberRoleState(context, {
            ...event,
            type: 'member.updated',
        });

        if (reconciliationResult.isErr()) {
            return err(reconciliationResult.error);
        }

        if (reconciliationResult.value.status === 'applied') {
            handledAction = reconciliationResult.value.action;
        }
    }

    if (event.type === 'role.deleted') {
        const cleanupResult = await cleanupDeletedRoleReferences(context, {
            ...event,
            type: 'role.deleted',
        });

        if (cleanupResult.isErr()) {
            return err(cleanupResult.error);
        }

        if (cleanupResult.value.status === 'applied') {
            handledAction = cleanupResult.value.action;
        }
    }

    if (event.type === 'reaction.added' || event.type === 'reaction.removed') {
        const reactionRoleResult = await routeReactionRoleEvent(context, event);

        if (reactionRoleResult.isErr()) {
            return err(reactionRoleResult.error);
        }

        if (reactionRoleResult.value.status === 'applied') {
            return handledActionResult(event.type, reactionRoleResult.value.action);
        }

        if (reactionRoleResult.value.reason === 'bot-user-unavailable') {
            return ok({
                eventType: event.type,
                status: 'ignored',
                reason: 'bot-user-unavailable',
            });
        }

        if (event.type === 'reaction.added') {
            const verificationResult = await applyVerificationReaction(context, {
                ...event,
                type: 'reaction.added',
            });

            if (verificationResult.isErr()) {
                return err(verificationResult.error);
            }

            if (verificationResult.value.status === 'applied') {
                return handledActionResult(event.type, verificationResult.value.action);
            }

            if (verificationResult.value.reason === 'bot-user-unavailable') {
                return ok({
                    eventType: event.type,
                    status: 'ignored',
                    reason: 'bot-user-unavailable',
                });
            }

            const vcGeneratorResult = await handleVcGeneratorReactionControl(context, {
                ...event,
                type: 'reaction.added',
            });

            if (vcGeneratorResult.isErr()) {
                return err(vcGeneratorResult.error);
            }

            if (vcGeneratorResult.value.status === 'applied') {
                return handledActionResult(event.type, vcGeneratorResult.value.action);
            }

            const ticketResult = await routeTicketReactionEvent(context, {
                ...event,
                type: 'reaction.added',
            });

            if (ticketResult.isErr()) {
                return err(ticketResult.error);
            }

            if (ticketResult.value.status === 'applied') {
                return handledActionResult(event.type, ticketResult.value.action);
            }
        }

        const suggestionResult = await routeSuggestionReactionEvent(context, event);

        if (suggestionResult.isErr()) {
            return err(suggestionResult.error);
        }

        if (suggestionResult.value.status === 'applied') {
            return handledActionResult(event.type, suggestionResult.value.action);
        }

        const giveawayResult = await routeGiveawayReactionEvent(context, event);

        if (giveawayResult.isErr()) {
            return err(giveawayResult.error);
        }

        if (giveawayResult.value.status === 'applied') {
            return handledActionResult(event.type, giveawayResult.value.action);
        }
    }

    if (event.type === 'channel.deleted') {
        const vcGeneratorResult = await markVcGeneratorChannelDeleted(context, {
            ...event,
            type: 'channel.deleted',
        });

        if (vcGeneratorResult.isErr()) {
            return err(vcGeneratorResult.error);
        }

        if (vcGeneratorResult.value.status === 'applied') {
            handledAction = vcGeneratorResult.value.action;
        }

        const ticketResult = await routeTicketChannelDeletedEvent(context, {
            ...event,
            type: 'channel.deleted',
        });

        if (ticketResult.isErr()) {
            return err(ticketResult.error);
        }

        if (!handledAction && ticketResult.value.status === 'applied') {
            handledAction = ticketResult.value.action;
        }
    }

    if (isStructureObservedEvent(event)) {
        const structureResult = await recordObservedStructureEvent(context, event);

        if (structureResult.isErr()) {
            return err(structureResult.error);
        }

        if (!handledAction && structureResult.value.status === 'recorded') {
            handledAction = structureResult.value.action;
        }
    }

    const loggingResult = await logServerEvent(context, event);

    if (loggingResult.isErr()) {
        return err(loggingResult.error);
    }

    if (handledAction) {
        return handledActionResult(event.type, handledAction);
    }

    if (loggingResult.value.status === 'logged') {
        return handledActionResult(event.type, loggingResult.value.action);
    }

    return ok({
        eventType: event.type,
        status: 'ignored',
        reason: 'no-feature-handler',
    });
}

function isStructureObservedEvent(
    event: Exclude<BotFeatureEvent, { type: 'guild.lifecycle.created' | 'guild.lifecycle.deleted' | 'message.created' }>
): event is Extract<
    BotFeatureEvent,
    | { type: 'guild.lifecycle.updated' }
    | { type: 'role.created' | 'role.updated' | 'role.deleted' }
    | { type: 'channel.created' | 'channel.updated' | 'channel.deleted' }
> {
    return (
        event.type === 'guild.lifecycle.updated' ||
        event.type === 'role.created' ||
        event.type === 'role.updated' ||
        event.type === 'role.deleted' ||
        event.type === 'channel.created' ||
        event.type === 'channel.updated' ||
        event.type === 'channel.deleted'
    );
}

async function routeVoiceStateEvent(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'voice_state.updated' }>
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const xpResult = await trackXpVoiceStateUpdate(context, event);

    if (xpResult.isErr()) {
        return err(xpResult.error);
    }

    if (xpResult.value.status === 'ignored' && xpResult.value.reason === 'guild-not-processable') {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'guild-not-processable',
        });
    }

    const vcGeneratorResult = await handleVcGeneratorVoiceStateUpdate(context, event);

    if (vcGeneratorResult.isErr()) {
        return err(vcGeneratorResult.error);
    }

    const vcGeneratorCleanupResult = await cleanupEmptyGeneratedVoiceChannelAfterVoiceStateUpdate(context, event);

    if (vcGeneratorCleanupResult.isErr()) {
        return err(vcGeneratorCleanupResult.error);
    }

    const loggingResult = await logServerEvent(context, event);

    if (loggingResult.isErr()) {
        return err(loggingResult.error);
    }

    if (xpResult.value.status === 'awarded') {
        return ok({
            eventType: event.type,
            status: 'handled',
            action: xpResult.value.action,
        });
    }

    if (vcGeneratorResult.value.status === 'applied') {
        return ok({
            eventType: event.type,
            status: 'handled',
            action: vcGeneratorResult.value.action,
        });
    }

    if (vcGeneratorCleanupResult.value.status === 'applied') {
        return ok({
            eventType: event.type,
            status: 'handled',
            action: vcGeneratorCleanupResult.value.action,
        });
    }

    if (loggingResult.value.status === 'logged') {
        return ok({
            eventType: event.type,
            status: 'handled',
            action: loggingResult.value.action,
        });
    }

    return ok({
        eventType: event.type,
        status: 'ignored',
        reason: 'no-feature-handler',
    });
}
