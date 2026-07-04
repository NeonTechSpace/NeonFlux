import {
    createObservedModerationCase,
    findRecentModerationCaseByTargetAction,
    listModerationCaseEventsByCaseId,
    recordModerationCaseEvent,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureEvent, BotFeatureHandlerContext, BotFeatureRouteError } from './bot-feature-types.js';

export type BotModerationBanEvent = Extract<BotFeatureEvent, { type: 'ban.added' | 'ban.removed' }>;

export type BotModerationReconciliationResult = {
    status: 'handled';
    action: 'event.moderation.ban_added' | 'event.moderation.ban_removed';
};

const recentCaseWindowMs = 5 * 60 * 1_000;
const observedEventType = 'action.observed';
const observedCaseStatuses = ['open', 'resolved'] as const;

export async function reconcileModerationBanEvent(
    context: BotFeatureHandlerContext,
    event: BotModerationBanEvent
): Promise<Result<BotModerationReconciliationResult, BotFeatureRouteError>> {
    const action = getModerationAction(event);
    const recentCaseResult = await findRecentModerationCaseByTargetAction(context.db, {
        guildId: event.guildId,
        targetUserId: event.userId,
        action,
        statuses: observedCaseStatuses,
        since: new Date(Date.now() - recentCaseWindowMs),
    });

    if (recentCaseResult.isOk()) {
        const observedResult = await recordObservedEventIfMissing(context, {
            caseId: recentCaseResult.value.id,
            action,
            sourceEventType: event.type,
            userId: event.userId,
        });

        if (observedResult.isErr()) {
            return err(observedResult.error);
        }

        return ok({
            status: 'handled',
            action: getHandledAction(event),
        });
    }

    if (recentCaseResult.error.type !== 'not-found') {
        return err('database-error');
    }

    const observedCaseResult = await createObservedModerationCase(context.db, {
        guildId: event.guildId,
        action,
        targetUserId: event.userId,
        eventType: observedEventType,
        details: createObservedEventDetails(action, event.type, event.userId),
    });

    if (observedCaseResult.isErr()) {
        return err('database-error');
    }

    return ok({
        status: 'handled',
        action: getHandledAction(event),
    });
}

async function recordObservedEventIfMissing(
    context: BotFeatureHandlerContext,
    input: {
        caseId: string;
        action: 'ban' | 'unban';
        sourceEventType: BotModerationBanEvent['type'];
        userId: string;
    }
): Promise<Result<void, BotFeatureRouteError>> {
    const existingEventsResult = await listModerationCaseEventsByCaseId(context.db, {
        caseId: input.caseId,
        eventType: observedEventType,
        limit: 1,
    });

    if (existingEventsResult.isErr()) {
        return err('database-error');
    }

    if (existingEventsResult.value.length > 0) {
        return ok(undefined);
    }

    const eventResult = await recordModerationCaseEvent(context.db, {
        caseId: input.caseId,
        eventType: observedEventType,
        details: createObservedEventDetails(input.action, input.sourceEventType, input.userId),
    });

    return eventResult.isOk() ? ok(undefined) : err('database-error');
}

function getModerationAction(event: BotModerationBanEvent): 'ban' | 'unban' {
    switch (event.type) {
        case 'ban.added':
            return 'ban';
        case 'ban.removed':
            return 'unban';
    }
}

function getHandledAction(event: BotModerationBanEvent): BotModerationReconciliationResult['action'] {
    switch (event.type) {
        case 'ban.added':
            return 'event.moderation.ban_added';
        case 'ban.removed':
            return 'event.moderation.ban_removed';
    }
}

function createObservedEventDetails(
    action: 'ban' | 'unban',
    sourceEventType: BotModerationBanEvent['type'],
    userId: string
): Record<string, unknown> {
    return {
        action,
        source: 'fluxer',
        sourceEventType,
        userId,
    };
}
