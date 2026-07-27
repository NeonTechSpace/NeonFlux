import { recordGuildMemberFlowEvent, recordGuildMessageActivity } from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext, BotGrowthTelemetryEvent } from './bot-feature-types.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';

type BotGrowthTrackingEvent = BotGrowthTelemetryEvent;

type BotGrowthTrackingOptions = {
    signal?: AbortSignal;
};

export type BotGrowthTrackingResult =
    | { status: 'tracked' }
    | { status: 'ignored'; reason: 'bot-authored-message' | 'guild-not-processable' | 'no-feature-handler' };

export async function trackGrowthOverviewEvent(
    context: BotFeatureHandlerContext,
    event: BotGrowthTrackingEvent,
    options: BotGrowthTrackingOptions = {}
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    options.signal?.throwIfAborted();
    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    switch (event.type) {
        case 'message.created':
            return trackMessageActivity(context, event, options);

        case 'member.joined':
            return trackMemberJoin(context, event, options);

        case 'member.left':
            return trackMemberLeave(context, event, options);
    }
}

async function trackMessageActivity(
    context: BotFeatureHandlerContext,
    event: Extract<BotGrowthTelemetryEvent, { type: 'message.created' }>,
    options: BotGrowthTrackingOptions
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    if (event.authorIsBot || !event.guildId) {
        return ok({ status: 'ignored', reason: event.authorIsBot ? 'bot-authored-message' : 'guild-not-processable' });
    }

    const input = {
        guildId: event.guildId,
        messageId: event.messageId,
        occurredAt: event.occurredAt,
    };
    const result = options.signal
        ? await recordGuildMessageActivity(context.db, input, { signal: options.signal })
        : await recordGuildMessageActivity(context.db, input);

    return result.isOk() ? ok({ status: 'tracked' }) : err('database-error');
}

async function trackMemberJoin(
    context: BotFeatureHandlerContext,
    event: Extract<BotGrowthTelemetryEvent, { type: 'member.joined' }>,
    options: BotGrowthTrackingOptions
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    const input = {
        eventType: 'join',
        guildId: event.guildId,
        membershipStartedAt: event.membershipStartedAt,
        occurredAt: event.membershipStartedAt,
        userId: event.userId,
    } as const;
    const recordResult = options.signal
        ? await recordGuildMemberFlowEvent(context.db, input, { signal: options.signal })
        : await recordGuildMemberFlowEvent(context.db, input);

    return recordResult.isOk() ? ok({ status: 'tracked' }) : err('database-error');
}

async function trackMemberLeave(
    context: BotFeatureHandlerContext,
    event: Extract<BotGrowthTelemetryEvent, { type: 'member.left' }>,
    options: BotGrowthTrackingOptions
): Promise<Result<BotGrowthTrackingResult, 'database-error'>> {
    const input = {
        guildId: event.guildId,
        userId: event.userId,
        eventType: 'leave',
    } as const;
    const result = options.signal
        ? await recordGuildMemberFlowEvent(context.db, input, { signal: options.signal })
        : await recordGuildMemberFlowEvent(context.db, input);

    return result.isOk() ? ok({ status: 'tracked' }) : err('database-error');
}
