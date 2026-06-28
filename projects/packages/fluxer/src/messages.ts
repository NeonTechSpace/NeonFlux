import { Client, type MessageSendOptions } from '@fluxerjs/core';
import { err, ok, type Result } from 'neverthrow';

import type { FluxerBot } from './client.js';
import { readFluxerGuildStructure } from './guild-structure.js';

export * from './message-reaction-emojis.js';

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

export type EditFluxerChannelMessageInput = {
    client: FluxerBot['client'];
    channelId: string;
    messageId: string;
    content?: string;
    embeds?: MessageSendOptions['embeds'];
};

export type EditFluxerGuildChannelMessageInput = EditFluxerChannelMessageInput & {
    guildId: string;
};

export type EditFluxerBotGuildChannelMessageInput = Omit<EditFluxerGuildChannelMessageInput, 'client'> & {
    botToken: string;
};

export type ReactFluxerChannelMessageInput = {
    client: FluxerBot['client'];
    channelId: string;
    messageId: string;
    emoji: string;
};

export type ReactFluxerGuildChannelMessageInput = ReactFluxerChannelMessageInput & {
    guildId: string;
};

export type ReactFluxerBotGuildChannelMessageInput = Omit<ReactFluxerGuildChannelMessageInput, 'client'> & {
    botToken: string;
};

export type RemoveFluxerChannelMessageReactionInput = {
    client: FluxerBot['client'];
    channelId: string;
    messageId: string;
    emoji: string;
    userId: string;
};

export type RemoveFluxerGuildChannelMessageReactionInput = RemoveFluxerChannelMessageReactionInput & {
    guildId: string;
};

export type RemoveFluxerBotGuildChannelMessageReactionInput = Omit<
    RemoveFluxerGuildChannelMessageReactionInput,
    'client' | 'userId'
> & {
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

export type EditFluxerChannelMessageError =
    | { type: 'missing-input'; field: 'channelId' | 'messageId' | 'message' }
    | { type: 'edit-failed'; error: unknown };

export type EditFluxerGuildChannelMessageError =
    | EditFluxerChannelMessageError
    | { type: 'missing-input'; field: 'guildId' }
    | { type: 'channel-not-in-guild' }
    | { type: 'guild-lookup-failed'; error?: unknown };

export type EditFluxerBotGuildChannelMessageError =
    | EditFluxerGuildChannelMessageError
    | { type: 'missing-input'; field: 'botToken' }
    | { type: 'login-failed'; error: unknown };

export type ReactFluxerChannelMessageError =
    | { type: 'missing-input'; field: 'channelId' | 'messageId' | 'emoji' }
    | { type: 'react-failed'; error: unknown };

export type ReactFluxerGuildChannelMessageError =
    | ReactFluxerChannelMessageError
    | { type: 'missing-input'; field: 'guildId' }
    | { type: 'channel-not-in-guild' }
    | { type: 'guild-lookup-failed'; error?: unknown };

export type ReactFluxerBotGuildChannelMessageError =
    | ReactFluxerGuildChannelMessageError
    | { type: 'missing-input'; field: 'botToken' }
    | { type: 'login-failed'; error: unknown };

export type RemoveFluxerChannelMessageReactionError =
    | { type: 'missing-input'; field: 'channelId' | 'messageId' | 'emoji' | 'userId' }
    | { type: 'unsupported'; feature: 'message-reaction-removal' }
    | { type: 'remove-reaction-failed'; error: unknown };

export type RemoveFluxerGuildChannelMessageReactionError =
    | RemoveFluxerChannelMessageReactionError
    | { type: 'missing-input'; field: 'guildId' }
    | { type: 'channel-not-in-guild' }
    | { type: 'guild-lookup-failed'; error?: unknown };

export type RemoveFluxerBotGuildChannelMessageReactionError =
    | RemoveFluxerGuildChannelMessageReactionError
    | { type: 'missing-input'; field: 'botToken' }
    | { type: 'login-failed'; error: unknown }
    | { type: 'bot-user-unavailable' };

type ReactableMessageChannel = {
    messages: {
        fetch(messageId: string): Promise<{
            id?: string;
            channelId?: string;
            guildId?: string | null;
            edit?(options: MessageSendOptions): Promise<{
                id: string;
                channelId: string;
                guildId?: string | null;
            }>;
            react(emoji: string): Promise<void>;
            removeReaction?(emoji: string, userId?: string): Promise<void>;
        }>;
    };
};

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

export async function editFluxerBotGuildChannelMessage(
    input: EditFluxerBotGuildChannelMessageInput
): Promise<Result<FluxerSentMessage, EditFluxerBotGuildChannelMessageError>> {
    const botToken = input.botToken.trim();

    if (!botToken) {
        return err({ type: 'missing-input', field: 'botToken' });
    }

    const client = new Client({ gatewayDebug: false });

    try {
        await client.login(botToken);

        return await editFluxerGuildChannelMessage({
            client,
            guildId: input.guildId,
            channelId: input.channelId,
            messageId: input.messageId,
            ...(input.content ? { content: input.content } : {}),
            ...(input.embeds ? { embeds: input.embeds } : {}),
        });
    } catch (error) {
        return err({ type: 'login-failed', error });
    } finally {
        await client.destroy().catch(() => undefined);
    }
}

export async function reactFluxerBotGuildChannelMessage(
    input: ReactFluxerBotGuildChannelMessageInput
): Promise<Result<void, ReactFluxerBotGuildChannelMessageError>> {
    const botToken = input.botToken.trim();

    if (!botToken) {
        return err({ type: 'missing-input', field: 'botToken' });
    }

    const client = new Client({ gatewayDebug: false });

    try {
        await client.login(botToken);

        return await reactFluxerGuildChannelMessage({
            client,
            guildId: input.guildId,
            channelId: input.channelId,
            messageId: input.messageId,
            emoji: input.emoji,
        });
    } catch (error) {
        return err({ type: 'login-failed', error });
    } finally {
        await client.destroy().catch(() => undefined);
    }
}

export async function removeFluxerBotGuildChannelMessageReaction(
    input: RemoveFluxerBotGuildChannelMessageReactionInput
): Promise<Result<void, RemoveFluxerBotGuildChannelMessageReactionError>> {
    const botToken = input.botToken.trim();

    if (!botToken) {
        return err({ type: 'missing-input', field: 'botToken' });
    }

    const client = new Client({ gatewayDebug: false });

    try {
        await client.login(botToken);

        const botUserId = getClientUserId(client);

        if (!botUserId) {
            return err({ type: 'bot-user-unavailable' });
        }

        return await removeFluxerGuildChannelMessageReaction({
            client,
            guildId: input.guildId,
            channelId: input.channelId,
            messageId: input.messageId,
            emoji: input.emoji,
            userId: botUserId,
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

export async function reactFluxerGuildChannelMessage(
    input: ReactFluxerGuildChannelMessageInput
): Promise<Result<void, ReactFluxerGuildChannelMessageError>> {
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

    return reactFluxerChannelMessage(input);
}

export async function editFluxerGuildChannelMessage(
    input: EditFluxerGuildChannelMessageInput
): Promise<Result<FluxerSentMessage, EditFluxerGuildChannelMessageError>> {
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

    return editFluxerChannelMessage(input);
}

export async function removeFluxerGuildChannelMessageReaction(
    input: RemoveFluxerGuildChannelMessageReactionInput
): Promise<Result<void, RemoveFluxerGuildChannelMessageReactionError>> {
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

    return removeFluxerChannelMessageReaction(input);
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

export async function editFluxerChannelMessage(
    input: EditFluxerChannelMessageInput
): Promise<Result<FluxerSentMessage, EditFluxerChannelMessageError>> {
    const channelId = input.channelId.trim();
    const messageId = input.messageId.trim();
    const content = input.content?.trim();
    const embeds = input.embeds ?? [];

    if (!channelId) {
        return err({ type: 'missing-input', field: 'channelId' });
    }

    if (!messageId) {
        return err({ type: 'missing-input', field: 'messageId' });
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
        const channel = await input.client.channels.resolve(channelId);

        if (!isReactableMessageChannel(channel)) {
            return err({ type: 'edit-failed', error: new Error('Message channel is not fetchable.') });
        }

        const message = await channel.messages.fetch(messageId);

        if (typeof message.edit !== 'function') {
            return err({ type: 'edit-failed', error: new Error('Message is not editable.') });
        }

        const editedMessage = await message.edit(payload);

        return ok({
            id: editedMessage.id,
            channelId: editedMessage.channelId,
            guildId: editedMessage.guildId ?? null,
        });
    } catch (error) {
        return err({ type: 'edit-failed', error });
    }
}

export async function reactFluxerChannelMessage(
    input: ReactFluxerChannelMessageInput
): Promise<Result<void, ReactFluxerChannelMessageError>> {
    const channelId = input.channelId.trim();
    const messageId = input.messageId.trim();
    const emoji = input.emoji.trim();

    if (!channelId) {
        return err({ type: 'missing-input', field: 'channelId' });
    }

    if (!messageId) {
        return err({ type: 'missing-input', field: 'messageId' });
    }

    if (!emoji) {
        return err({ type: 'missing-input', field: 'emoji' });
    }

    try {
        const channel = await input.client.channels.resolve(channelId);

        if (!isReactableMessageChannel(channel)) {
            return err({ type: 'react-failed', error: new Error('Message channel is not fetchable.') });
        }

        const message = await channel.messages.fetch(messageId);

        await message.react(emoji);

        return ok(undefined);
    } catch (error) {
        return err({ type: 'react-failed', error });
    }
}

export async function removeFluxerChannelMessageReaction(
    input: RemoveFluxerChannelMessageReactionInput
): Promise<Result<void, RemoveFluxerChannelMessageReactionError>> {
    const channelId = input.channelId.trim();
    const messageId = input.messageId.trim();
    const emoji = input.emoji.trim();
    const userId = input.userId.trim();

    if (!channelId) {
        return err({ type: 'missing-input', field: 'channelId' });
    }

    if (!messageId) {
        return err({ type: 'missing-input', field: 'messageId' });
    }

    if (!emoji) {
        return err({ type: 'missing-input', field: 'emoji' });
    }

    if (!userId) {
        return err({ type: 'missing-input', field: 'userId' });
    }

    try {
        const channel = await input.client.channels.resolve(channelId);

        if (!isReactableMessageChannel(channel)) {
            return err({ type: 'remove-reaction-failed', error: new Error('Message channel is not fetchable.') });
        }

        const message = await channel.messages.fetch(messageId);

        if (typeof message.removeReaction !== 'function') {
            return err({ type: 'unsupported', feature: 'message-reaction-removal' });
        }

        await message.removeReaction(emoji, userId);

        return ok(undefined);
    } catch (error) {
        return err({ type: 'remove-reaction-failed', error });
    }
}

function isReactableMessageChannel(channel: unknown): channel is ReactableMessageChannel {
    if (typeof channel !== 'object' || channel === null) {
        return false;
    }

    const possibleChannel = channel as { messages?: { fetch?: unknown } };

    return typeof possibleChannel.messages?.fetch === 'function';
}

function getClientUserId(client: Client): string | undefined {
    const userId = (client as { user?: { id?: unknown } }).user?.id?.toString().trim();

    return userId === '' ? undefined : userId;
}
