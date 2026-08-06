import type { Client, MessageSendOptions } from '@fluxerjs/core';
import {
    DASHBOARD_MESSAGE_MENTION_POLICY,
    parseOutgoingMessage,
    type DashboardMessageMentionPolicy,
    type OutgoingEmbed,
    type OutgoingMessage,
} from '@neonflux/messaging';
import { err, ok, type Result } from 'neverthrow';

import type { FluxerBot } from './client.js';
import { createFluxerAuthenticatedRestClient } from './authenticated-rest-client.js';
import { readFluxerGuildStructure } from './guild-structure.js';

export type SendFluxerChannelMessageInput = {
    allowedMentions?: MessageSendOptions['allowedMentions'];
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
    allowedMentions?: MessageSendOptions['allowedMentions'];
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

export type FluxerSentMessage = {
    id: string;
    channelId: string;
    guildId: string | null;
};

export type SendFluxerChannelMessageError =
    | { type: 'missing-input'; field: 'channelId' | 'message' }
    | { type: 'send-failed'; error: unknown };

export type SendDashboardFluxerMessageInput = {
    allowMassMentions: boolean;
    client: FluxerBot['client'];
    channelId: string;
    message: OutgoingMessage;
};

export type SendFluxerGuildChannelMessageError =
    | SendFluxerChannelMessageError
    | { type: 'missing-input'; field: 'guildId' }
    | { type: 'channel-not-in-guild' }
    | { type: 'guild-lookup-failed'; error?: unknown };

export type SendFluxerBotChannelMessageError =
    | SendFluxerChannelMessageError
    | { type: 'missing-input'; field: 'botToken' }
    | { type: 'client-setup-failed'; error: unknown };

export type SendFluxerBotGuildChannelMessageError =
    | SendFluxerGuildChannelMessageError
    | { type: 'missing-input'; field: 'botToken' }
    | { type: 'client-setup-failed'; error: unknown };

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
    | { type: 'client-setup-failed'; error: unknown };

export async function sendFluxerBotChannelMessage(
    input: SendFluxerBotChannelMessageInput
): Promise<Result<FluxerSentMessage, SendFluxerBotChannelMessageError>> {
    const botToken = input.botToken.trim();

    if (!botToken) {
        return err({ type: 'missing-input', field: 'botToken' });
    }

    let client: Client | undefined;

    try {
        client = createFluxerAuthenticatedRestClient(botToken);
        return await sendFluxerChannelMessage({
            ...(input.allowedMentions ? { allowedMentions: input.allowedMentions } : {}),
            client,
            channelId: input.channelId,
            ...(input.content ? { content: input.content } : {}),
            ...(input.embeds ? { embeds: input.embeds } : {}),
        });
    } catch (error) {
        return err({ type: 'client-setup-failed', error });
    } finally {
        await client?.destroy().catch(() => undefined);
    }
}

export async function sendFluxerBotGuildChannelMessage(
    input: SendFluxerBotGuildChannelMessageInput
): Promise<Result<FluxerSentMessage, SendFluxerBotGuildChannelMessageError>> {
    const botToken = input.botToken.trim();

    if (!botToken) {
        return err({ type: 'missing-input', field: 'botToken' });
    }

    let client: Client | undefined;

    try {
        client = createFluxerAuthenticatedRestClient(botToken);
        return await sendFluxerGuildChannelMessage({
            ...(input.allowedMentions ? { allowedMentions: input.allowedMentions } : {}),
            client,
            guildId: input.guildId,
            channelId: input.channelId,
            ...(input.content ? { content: input.content } : {}),
            ...(input.embeds ? { embeds: input.embeds } : {}),
        });
    } catch (error) {
        return err({ type: 'client-setup-failed', error });
    } finally {
        await client?.destroy().catch(() => undefined);
    }
}

export async function editFluxerBotGuildChannelMessage(
    input: EditFluxerBotGuildChannelMessageInput
): Promise<Result<FluxerSentMessage, EditFluxerBotGuildChannelMessageError>> {
    const botToken = input.botToken.trim();

    if (!botToken) {
        return err({ type: 'missing-input', field: 'botToken' });
    }

    let client: Client | undefined;

    try {
        client = createFluxerAuthenticatedRestClient(botToken);
        return await editFluxerGuildChannelMessage({
            ...(input.allowedMentions ? { allowedMentions: input.allowedMentions } : {}),
            client,
            guildId: input.guildId,
            channelId: input.channelId,
            messageId: input.messageId,
            ...(input.content ? { content: input.content } : {}),
            ...(input.embeds ? { embeds: input.embeds } : {}),
        });
    } catch (error) {
        return err({ type: 'client-setup-failed', error });
    } finally {
        await client?.destroy().catch(() => undefined);
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

    if (input.allowedMentions) {
        payload.allowedMentions = input.allowedMentions;
    }

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

export async function sendDashboardFluxerMessage(
    input: SendDashboardFluxerMessageInput
): Promise<Result<FluxerSentMessage, SendFluxerChannelMessageError>> {
    const message = parseOutgoingMessage(input.message);
    if (message.isErr()) return err({ type: 'missing-input', field: 'message' });
    const payload = toDashboardFluxerMessagePayload(message.value, {
        allowMassMentions: input.allowMassMentions,
    });
    return sendFluxerChannelMessage({
        client: input.client,
        channelId: input.channelId,
        ...payload,
    });
}

export function toDashboardFluxerMessagePayload(
    message: OutgoingMessage,
    mentionPolicy: DashboardMessageMentionPolicy = { allowMassMentions: false }
): MessageSendOptions {
    const embeds: NonNullable<MessageSendOptions['embeds']> = message.embeds.map(toFluxerEmbed);
    const allowedMentionTypes = mentionPolicy.allowMassMentions
        ? [...DASHBOARD_MESSAGE_MENTION_POLICY.allowedMentionTypes, DASHBOARD_MESSAGE_MENTION_POLICY.massMentionType]
        : [...DASHBOARD_MESSAGE_MENTION_POLICY.allowedMentionTypes];
    return {
        allowedMentions: { parse: allowedMentionTypes },
        ...(message.content ? { content: message.content } : {}),
        ...(embeds.length > 0 ? { embeds } : {}),
    };
}

function toFluxerEmbed(embed: OutgoingEmbed): NonNullable<MessageSendOptions['embeds']>[number] {
    return {
        ...(embed.author
            ? {
                  author: {
                      name: embed.author.name,
                      ...(embed.author.iconUrl ? { icon_url: embed.author.iconUrl } : {}),
                      ...(embed.author.url ? { url: embed.author.url } : {}),
                  },
              }
            : {}),
        ...(embed.color === undefined ? {} : { color: embed.color }),
        description: embed.description ?? null,
        ...(embed.fields ? { fields: embed.fields } : {}),
        ...(embed.footer
            ? {
                  footer: {
                      text: embed.footer.text,
                      ...(embed.footer.iconUrl ? { icon_url: embed.footer.iconUrl } : {}),
                  },
              }
            : {}),
        ...(embed.imageUrl ? { image: { url: embed.imageUrl } } : {}),
        ...(embed.thumbnailUrl ? { thumbnail: { url: embed.thumbnailUrl } } : {}),
        ...(embed.timestamp ? { timestamp: embed.timestamp } : {}),
        ...(embed.title ? { title: embed.title } : {}),
        ...(embed.url ? { url: embed.url } : {}),
    };
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

    if (input.allowedMentions) {
        payload.allowedMentions = input.allowedMentions;
    }

    if (content) {
        payload.content = content;
    }

    if (embeds.length > 0) {
        payload.embeds = embeds;
    }

    try {
        const message = await input.client.channels.fetchMessage(channelId, messageId);
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
