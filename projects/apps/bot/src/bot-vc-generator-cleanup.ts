import { findGeneratedVoiceChannelByChannelId, updateGeneratedVoiceChannelStatus } from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import type {
    BotFeatureEvent,
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteHandledAction,
} from './bot-feature-types.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';

type VcGeneratorCleanupResult =
    | { status: 'applied'; action: BotFeatureRouteHandledAction }
    | { status: 'ignored'; reason?: 'guild-not-processable' | 'no-feature-handler' };

export async function cleanupEmptyGeneratedVoiceChannelAfterVoiceStateUpdate(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'voice_state.updated' }>
): Promise<Result<VcGeneratorCleanupResult, BotFeatureRouteError>> {
    if (!event.guildId || !event.oldChannelId || event.oldChannelOccupancy !== 0) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    const generatedChannelResult = await findGeneratedVoiceChannelByChannelId(context.db, {
        channelId: event.oldChannelId,
    });

    if (generatedChannelResult.isErr()) {
        return generatedChannelResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    if (generatedChannelResult.value.guildId !== event.guildId || generatedChannelResult.value.status !== 'active') {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const deleteResult = await createFluxerPlatform(context.client).channels.delete({
        channelId: event.oldChannelId,
    });

    if (deleteResult.isErr() && deleteResult.error.type !== 'not-found') {
        return err('platform-error');
    }

    const updateResult = await updateGeneratedVoiceChannelStatus(context.db, {
        guildId: event.guildId,
        channelId: event.oldChannelId,
        status: 'deleted',
    });

    if (updateResult.isErr()) {
        return err('database-error');
    }

    return ok({ status: 'applied', action: 'event.vc_generator.cleaned_up' });
}
