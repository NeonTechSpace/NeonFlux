import type { MessageSendOptions } from '@fluxerjs/core';
import { err, ok, type Result } from 'neverthrow';

import type { FluxerBot } from './client.js';
import { sendFluxerChannelMessage, type FluxerSentMessage } from './messages.js';
import { mapPlatformError, requireTextInputs, type FluxerPlatformError } from './platform-shared.js';

type MessageLookupChannel = {
    messages: {
        fetch(messageId: string): Promise<{
            id: string;
            channelId: string;
            guildId: string | null;
            edit(options: { content?: string; embeds?: MessageSendOptions['embeds'] }): Promise<{
                id: string;
                channelId: string;
                guildId: string | null;
            }>;
            delete(): Promise<void>;
            react(emoji: string): Promise<void>;
        }>;
    };
};

export function createMessagePlatform(client: FluxerBot['client']) {
    return {
        send: (input: { channelId: string; content?: string; embeds?: MessageSendOptions['embeds'] }) =>
            sendFluxerChannelMessage({ client, ...input }),
        fetch: (input: { channelId: string; messageId: string }) => fetchMessage(client, input),
        edit: (input: {
            channelId: string;
            messageId: string;
            content?: string;
            embeds?: MessageSendOptions['embeds'];
        }) => editMessage(client, input),
        delete: (input: { channelId: string; messageId: string }) => deleteMessage(client, input),
        react: (input: { channelId: string; messageId: string; emoji: string }) => reactToMessage(client, input),
        bulkDelete: (input: { channelId: string; messageIds: string[] }) => bulkDeleteMessages(client, input),
    };
}

async function fetchMessage(
    client: FluxerBot['client'],
    input: { channelId: string; messageId: string }
): Promise<Result<FluxerSentMessage, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['channelId', 'messageId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    try {
        const message = await fetchSdkMessageValue(client, input);

        return ok({
            id: message.id,
            channelId: message.channelId,
            guildId: message.guildId,
        });
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function editMessage(
    client: FluxerBot['client'],
    input: { channelId: string; messageId: string; content?: string; embeds?: MessageSendOptions['embeds'] }
): Promise<Result<FluxerSentMessage, FluxerPlatformError>> {
    const payloadResult = normalizeMessageEditPayload(input);

    if (payloadResult.isErr()) {
        return err(payloadResult.error);
    }

    const messageResult = await fetchSdkMessage(client, input);

    if (messageResult.isErr()) {
        return err(messageResult.error);
    }

    try {
        const message = await messageResult.value.edit(payloadResult.value);

        return ok({
            id: message.id,
            channelId: message.channelId,
            guildId: message.guildId,
        });
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function deleteMessage(
    client: FluxerBot['client'],
    input: { channelId: string; messageId: string }
): Promise<Result<void, FluxerPlatformError>> {
    const messageResult = await fetchSdkMessage(client, input);

    if (messageResult.isErr()) {
        return err(messageResult.error);
    }

    try {
        await messageResult.value.delete();

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function reactToMessage(
    client: FluxerBot['client'],
    input: { channelId: string; messageId: string; emoji: string }
): Promise<Result<void, FluxerPlatformError>> {
    const emoji = input.emoji.trim();

    if (!emoji) {
        return err({ type: 'missing-input', field: 'emoji' });
    }

    const messageResult = await fetchSdkMessage(client, input);

    if (messageResult.isErr()) {
        return err(messageResult.error);
    }

    try {
        await messageResult.value.react(emoji);

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function bulkDeleteMessages(
    client: FluxerBot['client'],
    input: { channelId: string; messageIds: string[] }
): Promise<Result<void, FluxerPlatformError>> {
    const channelId = input.channelId.trim();
    const messageIds = input.messageIds.map((messageId) => messageId.trim()).filter(Boolean);

    if (!channelId) {
        return err({ type: 'missing-input', field: 'channelId' });
    }

    if (messageIds.length === 0) {
        return err({ type: 'missing-input', field: 'messageIds' });
    }

    try {
        const channel = await client.channels.fetch(channelId);

        await channel.bulkDeleteMessages(messageIds);

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function fetchSdkMessage(client: FluxerBot['client'], input: { channelId: string; messageId: string }) {
    const inputResult = requireTextInputs(input, ['channelId', 'messageId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    try {
        return ok(await fetchSdkMessageValue(client, input));
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function fetchSdkMessageValue(client: FluxerBot['client'], input: { channelId: string; messageId: string }) {
    const channel = await client.channels.resolve(input.channelId.trim());

    if (!hasMessageLookup(channel)) {
        throw new Error('message channel is not fetchable');
    }

    return await channel.messages.fetch(input.messageId.trim());
}

function normalizeMessageEditPayload(input: {
    content?: string;
    embeds?: MessageSendOptions['embeds'];
}): Result<{ content?: string; embeds?: MessageSendOptions['embeds'] }, FluxerPlatformError> {
    const content = input.content?.trim();
    const embeds = input.embeds && input.embeds.length > 0 ? input.embeds : undefined;

    if (!content && !embeds) {
        return err({ type: 'missing-input', field: 'message' });
    }

    return ok({
        ...(content ? { content } : {}),
        ...(embeds ? { embeds } : {}),
    });
}

function hasMessageLookup(channel: unknown): channel is MessageLookupChannel {
    if (typeof channel !== 'object' || channel === null) {
        return false;
    }

    const possibleChannel = channel as { messages?: { fetch?: unknown } };

    return typeof possibleChannel.messages?.fetch === 'function';
}
