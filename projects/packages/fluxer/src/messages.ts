import { Client, type MessageSendOptions } from '@fluxerjs/core';
import { err, ok, type Result } from 'neverthrow';

import type { FluxerBot } from './client.js';
import { readFluxerGuildStructure } from './guild-structure.js';

export type SendFluxerChannelMessageInput = {
    client: FluxerBot['client'];
    channelId: string;
    content?: string;
    embeds?: MessageSendOptions['embeds'];
};

export type SendFluxerGuildChannelMessageInput = SendFluxerChannelMessageInput & {
    guildId: string;
};

export type SendFluxerBotChannelMessageInput = Omit<SendFluxerChannelMessageInput, 'client'> & {
    botToken: string;
};

export type SendFluxerBotGuildChannelMessageInput = Omit<SendFluxerGuildChannelMessageInput, 'client'> & {
    botToken: string;
};

export type FluxerSentMessage = {
    id: string;
    channelId: string;
    guildId: string | null;
};

export type SendFluxerChannelMessageError =
    | { type: 'missing-input'; field: 'channelId' | 'message' }
    | { type: 'send-failed'; error: unknown };

export type SendFluxerGuildChannelMessageError =
    | SendFluxerChannelMessageError
    | { type: 'missing-input'; field: 'guildId' }
    | { type: 'channel-not-in-guild' }
    | { type: 'guild-lookup-failed'; error?: unknown };

export type SendFluxerBotChannelMessageError =
    | SendFluxerChannelMessageError
    | { type: 'missing-input'; field: 'botToken' }
    | { type: 'login-failed'; error: unknown };

export type SendFluxerBotGuildChannelMessageError =
    | SendFluxerGuildChannelMessageError
    | { type: 'missing-input'; field: 'botToken' }
    | { type: 'login-failed'; error: unknown };

export async function sendFluxerBotChannelMessage(
    input: SendFluxerBotChannelMessageInput
): Promise<Result<FluxerSentMessage, SendFluxerBotChannelMessageError>> {
    const botToken = input.botToken.trim();

    if (!botToken) {
        return err({ type: 'missing-input', field: 'botToken' });
    }

    const client = new Client({ gatewayDebug: false });

    try {
        await client.login(botToken);

        return await sendFluxerChannelMessage({
            client,
            channelId: input.channelId,
            ...(input.content ? { content: input.content } : {}),
            ...(input.embeds ? { embeds: input.embeds } : {}),
        });
    } catch (error) {
        return err({ type: 'login-failed', error });
    } finally {
        await client.destroy().catch(() => undefined);
    }
}

export async function sendFluxerBotGuildChannelMessage(
    input: SendFluxerBotGuildChannelMessageInput
): Promise<Result<FluxerSentMessage, SendFluxerBotGuildChannelMessageError>> {
    const botToken = input.botToken.trim();

    if (!botToken) {
        return err({ type: 'missing-input', field: 'botToken' });
    }

    const client = new Client({ gatewayDebug: false });

    try {
        await client.login(botToken);

        return await sendFluxerGuildChannelMessage({
            client,
            guildId: input.guildId,
            channelId: input.channelId,
            ...(input.content ? { content: input.content } : {}),
            ...(input.embeds ? { embeds: input.embeds } : {}),
        });
    } catch (error) {
        return err({ type: 'login-failed', error });
    } finally {
        await client.destroy().catch(() => undefined);
    }
}

export async function sendFluxerGuildChannelMessage(
    input: SendFluxerGuildChannelMessageInput
): Promise<Result<FluxerSentMessage, SendFluxerGuildChannelMessageError>> {
    const guildId = input.guildId.trim();
    const channelId = input.channelId.trim();

    if (!guildId) {
        return err({ type: 'missing-input', field: 'guildId' });
    }

    const structureResult = await readFluxerGuildStructure({
        client: input.client,
        guildId,
    });

    if (structureResult.isErr()) {
        switch (structureResult.error.type) {
            case 'missing-input':
                return err({ type: 'missing-input', field: 'guildId' });

            case 'fetch-failed':
                return err({ type: 'guild-lookup-failed', error: structureResult.error.error });

            case 'unavailable-or-not-found':
            case 'invalid-response':
                return err({ type: 'guild-lookup-failed' });
        }
    }

    if (!structureResult.value.channels.some((channel) => channel.id === channelId)) {
        return err({ type: 'channel-not-in-guild' });
    }

    return sendFluxerChannelMessage(input);
}

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
