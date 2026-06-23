import type { MessageSendOptions } from '@fluxerjs/core';
import { err, ok, type Result } from 'neverthrow';

import type { FluxerBot } from './client.js';

export type SendFluxerChannelMessageInput = {
    client: FluxerBot['client'];
    channelId: string;
    content?: string;
    embeds?: MessageSendOptions['embeds'];
};

export type FluxerSentMessage = {
    id: string;
    channelId: string;
    guildId: string | null;
};

export type SendFluxerChannelMessageError =
    | { type: 'missing-input'; field: 'channelId' | 'message' }
    | { type: 'send-failed'; error: unknown };

export async function sendFluxerChannelMessage(
    input: SendFluxerChannelMessageInput
): Promise<Result<FluxerSentMessage, SendFluxerChannelMessageError>> {
    const channelId = input.channelId.trim();
    const content = input.content?.trim();
    const embeds = input.embeds ?? [];

    if (!channelId) {
        return err({ type: 'missing-input', field: 'channelId' });
    }

    if (!content && embeds.length === 0) {
        return err({ type: 'missing-input', field: 'message' });
    }

    const payload: MessageSendOptions = {};

    if (content) {
        payload.content = content;
    }

    if (embeds.length > 0) {
        payload.embeds = embeds;
    }

    try {
        const message = await input.client.channels.send(channelId, payload);

        return ok({
            id: message.id,
            channelId: message.channelId,
            guildId: message.guildId ?? null,
        });
    } catch (error) {
        return err({ type: 'send-failed', error });
    }
}
