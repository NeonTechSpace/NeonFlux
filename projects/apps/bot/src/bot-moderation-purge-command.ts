import {
    createChannelModerationCase,
    recordModerationCaseEvent,
    updateModerationCaseStatus,
    voidModerationCase,
} from '@neonflux/db';
import { createFluxerPlatform, type FluxerPlatformError } from '@neonflux/fluxer';
import { err, type Result } from 'neverthrow';

import { sendBotFeatureReply } from './bot-feature-replies.js';
import type {
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteResult,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';

type ModerationPurgeInput = {
    count: number;
    reason?: string;
};

export async function runModerationPurgeCommand(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    input: ModerationPurgeInput
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!event.guildId) {
        return sendBotFeatureReply(context, event, 'Purge only works inside a community.', 'command.moderation.purge');
    }

    const platform = createFluxerPlatform(context.client);
    const messagesResult = await platform.messages.fetchMany({
        channelId: event.channelId,
        limit: input.count,
        before: event.messageId,
    });

    if (messagesResult.isErr()) {
        return sendBotFeatureReply(
            context,
            event,
            `Purge failed before deleting anything: ${formatPlatformFailure(messagesResult.error)}`,
            'command.moderation.purge'
        );
    }

    const messageIds = messagesResult.value.map((message) => message.id);

    if (messageIds.length === 0) {
        return sendBotFeatureReply(
            context,
            event,
            'No recent messages were found before this command.',
            'command.moderation.purge'
        );
    }

    const caseResult = await createChannelModerationCase(context.db, {
        guildId: event.guildId,
        action: 'purge',
        targetChannelId: event.channelId,
        actorUserId: event.authorId,
        ...(input.reason ? { reason: input.reason } : {}),
    });

    if (caseResult.isErr()) {
        return err('database-error');
    }

    const deleteResult = await platform.messages.bulkDelete({
        channelId: event.channelId,
        messageIds,
    });

    if (deleteResult.isErr()) {
        const failure = deleteResult.error;
        const eventResult = await recordModerationCaseEvent(context.db, {
            caseId: caseResult.value.id,
            eventType: 'action.failed',
            actorUserId: event.authorId,
            details: {
                action: 'purge',
                channelId: event.channelId,
                errorType: failure.type,
                requestedCount: input.count,
                matchedCount: messageIds.length,
            },
        });

        if (eventResult.isErr()) {
            return err('database-error');
        }

        const voidResult = await voidModerationCase(context.db, {
            caseId: caseResult.value.id,
            actorUserId: event.authorId,
            reason: `Fluxer bulk delete failed: ${failure.type}`,
        });

        if (voidResult.isErr()) {
            return err('database-error');
        }

        return sendBotFeatureReply(
            context,
            event,
            `Purge failed. Case #${String(caseResult.value.caseNumber)} was voided: ${formatPlatformFailure(failure)}`,
            'command.moderation.purge'
        );
    }

    const eventResult = await recordModerationCaseEvent(context.db, {
        caseId: caseResult.value.id,
        eventType: 'action.applied',
        actorUserId: event.authorId,
        details: {
            action: 'purge',
            channelId: event.channelId,
            requestedCount: input.count,
            deletedCount: messageIds.length,
        },
    });

    if (eventResult.isErr()) {
        return err('database-error');
    }

    const statusResult = await updateModerationCaseStatus(context.db, {
        caseId: caseResult.value.id,
        status: 'resolved',
    });

    if (statusResult.isErr()) {
        return err('database-error');
    }

    return sendBotFeatureReply(
        context,
        event,
        `Purge recorded as case #${String(caseResult.value.caseNumber)}. Deleted ${String(messageIds.length)} of ${String(input.count)} requested message(s) in <#${event.channelId}>.`,
        'command.moderation.purge'
    );
}

function formatPlatformFailure(errorValue: FluxerPlatformError): string {
    switch (errorValue.type) {
        case 'missing-input':
            return `missing ${errorValue.field}.`;
        case 'invalid-value':
            return `invalid ${errorValue.field}.`;
        case 'not-found':
            return 'the channel or messages could not be found.';
        case 'permission-denied':
            return 'NeonFlux is missing permission for that action.';
        case 'unsupported':
            return 'Fluxer does not support that action here.';
        case 'operation-failed':
            return 'Fluxer rejected the action.';
    }
}
