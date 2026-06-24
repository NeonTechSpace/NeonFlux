import { sendFluxerChannelMessage } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import type {
    BotFeatureHandlerContext,
    BotFeatureRouteHandledAction,
    BotFeatureRouteError,
    BotFeatureRouteResult,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';

export async function sendBotFeatureReply(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    content: string,
    action: BotFeatureRouteHandledAction
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const result = await sendFluxerChannelMessage({
        client: context.client,
        channelId: event.channelId,
        content,
    });

    if (result.isErr()) {
        return err('message-send-error');
    }

    return ok({
        eventType: event.type,
        status: 'handled',
        action,
    });
}
