import type { MessageSendOptions } from '@fluxerjs/core';
import { err, ok, type Result } from 'neverthrow';

import type { FluxerBot } from './client.js';
import { sendFluxerChannelMessage, type FluxerSentMessage } from './messages.js';
import { mapPlatformError, requireTextInputs, type FluxerPlatformError } from './platform-shared.js';

type MessageLookupChannel = {
    messages: {
        fetch(messageId: string): Promise<SdkMessage>;
        fetch(options: FetchManyMessagesOptions): Promise<{ values(): Iterable<SdkMessage> }>;
    };
};

type SdkMessage = {
    id: string;
    channelId: string;
    guildId: string | null;
    reactions?: SdkMessageReactions;
    edit(options: { content?: string; embeds?: MessageSendOptions['embeds'] }): Promise<{
        id: string;
        channelId: string;
        guildId: string | null;
    }>;
    delete(): Promise<void>;
    react(emoji: string): Promise<void>;
    removeReaction?(emoji: string, userId?: string): Promise<void>;
};

type SdkMessageReactions = {
    cache?: {
        get(key: string): unknown;
        values(): Iterable<unknown>;
    };
};

type SdkReaction = {
    emoji?: {
        id?: string | null;
        name?: string | null;
        identifier?: string | null;
    };
    users?: {
        fetch(options?: { limit?: number; after?: string }): Promise<SdkUserCollection | SdkUserLike[]>;
    };
};

type SdkUserCollection = {
    values(): Iterable<SdkUserLike>;
};

type SdkUserLike = {
    id: string;
    bot?: boolean;
};

export type FluxerReactionUser = {
    id: string;
    bot: boolean;
};

type FetchManyMessagesOptions = {
    limit?: number;
    before?: string;
    after?: string;
    around?: string;
};

export function createMessagePlatform(client: FluxerBot['client']) {
    return {
        send: (input: { channelId: string; content?: string; embeds?: MessageSendOptions['embeds'] }) =>
            sendFluxerChannelMessage({ client, ...input }),
        fetch: (input: { channelId: string; messageId: string }) => fetchMessage(client, input),
        fetchMany: (input: { channelId: string; limit: number; before?: string; after?: string; around?: string }) =>
            fetchManyMessages(client, input),
        edit: (input: {
            channelId: string;
            messageId: string;
            content?: string;
            embeds?: MessageSendOptions['embeds'];
        }) => editMessage(client, input),
        delete: (input: { channelId: string; messageId: string }) => deleteMessage(client, input),
        react: (input: { channelId: string; messageId: string; emoji: string }) => reactToMessage(client, input),
        removeReaction: (input: { channelId: string; messageId: string; emoji: string; userId: string }) =>
            removeMessageReaction(client, input),
        listReactionUsers: (input: {
            channelId: string;
            messageId: string;
            emoji: string;
            limit: number;
            after?: string;
        }) => listReactionUsers(client, input),
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

async function fetchManyMessages(
    client: FluxerBot['client'],
    input: { channelId: string; limit: number; before?: string; after?: string; around?: string }
): Promise<Result<FluxerSentMessage[], FluxerPlatformError>> {
    const channelId = input.channelId.trim();

    if (!channelId) {
        return err({ type: 'missing-input', field: 'channelId' });
    }

    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        return err({ type: 'invalid-value', field: 'limit' });
    }

    try {
        const channel = await client.channels.resolve(channelId);

        if (!hasMessageLookup(channel)) {
            return err({ type: 'not-found' });
        }

        const messages = await channel.messages.fetch({
            limit: input.limit,
            ...optionalTextOption('before', input.before),
            ...optionalTextOption('after', input.after),
            ...optionalTextOption('around', input.around),
        });

        return ok(
            [...messages.values()].map((message) => ({
                id: message.id,
                channelId: message.channelId,
                guildId: message.guildId,
            }))
        );
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

async function removeMessageReaction(
    client: FluxerBot['client'],
    input: { channelId: string; messageId: string; emoji: string; userId: string }
): Promise<Result<void, FluxerPlatformError>> {
    const emoji = input.emoji.trim();
    const userId = input.userId.trim();

    if (!emoji) {
        return err({ type: 'missing-input', field: 'emoji' });
    }

    if (!userId) {
        return err({ type: 'missing-input', field: 'userId' });
    }

    const messageResult = await fetchSdkMessage(client, input);

    if (messageResult.isErr()) {
        return err(messageResult.error);
    }

    if (typeof messageResult.value.removeReaction !== 'function') {
        return err({ type: 'unsupported', feature: 'message-reaction-removal' });
    }

    try {
        await messageResult.value.removeReaction(emoji, userId);

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function listReactionUsers(
    client: FluxerBot['client'],
    input: { channelId: string; messageId: string; emoji: string; limit: number; after?: string }
): Promise<Result<FluxerReactionUser[], FluxerPlatformError>> {
    const emoji = input.emoji.trim();

    if (!emoji) {
        return err({ type: 'missing-input', field: 'emoji' });
    }

    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        return err({ type: 'invalid-value', field: 'limit' });
    }

    const messageResult = await fetchSdkMessage(client, input);

    if (messageResult.isErr()) {
        return err(messageResult.error);
    }

    const reaction = findMessageReaction(messageResult.value, emoji);

    if (!reaction) {
        return err({ type: 'not-found' });
    }

    if (!reaction.users || typeof reaction.users.fetch !== 'function') {
        return err({ type: 'unsupported', feature: 'message-reaction-users' });
    }

    try {
        const users = await reaction.users.fetch({
            limit: input.limit,
            ...optionalTextOption('after', input.after),
        });

        return ok(readUserCollection(users));
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

function optionalTextOption<TKey extends 'before' | 'after' | 'around'>(
    key: TKey,
    value: string | undefined
): Partial<Record<TKey, string>> {
    const normalizedValue = value?.trim();

    return normalizedValue ? ({ [key]: normalizedValue } as Record<TKey, string>) : {};
}

function findMessageReaction(message: SdkMessage, emoji: string): SdkReaction | undefined {
    const cache = message.reactions?.cache;

    if (!cache) return undefined;

    const directMatch = cache.get(emoji);

    if (isReaction(directMatch)) {
        return directMatch;
    }

    for (const reaction of cache.values()) {
        if (isReaction(reaction) && reactionMatchesEmoji(reaction, emoji)) {
            return reaction;
        }
    }

    return undefined;
}

function reactionMatchesEmoji(reaction: SdkReaction, emoji: string): boolean {
    const candidates = [
        reaction.emoji?.identifier,
        reaction.emoji?.name,
        reaction.emoji?.id,
        reaction.emoji?.id && reaction.emoji.name ? `${reaction.emoji.name}:${reaction.emoji.id}` : undefined,
    ];

    return candidates.some((candidate) => candidate === emoji);
}

function readUserCollection(value: SdkUserCollection | SdkUserLike[]): FluxerReactionUser[] {
    const users = Array.isArray(value) ? value : [...value.values()];

    return users.map((user) => ({
        id: user.id,
        bot: user.bot ?? false,
    }));
}

function isReaction(value: unknown): value is SdkReaction {
    return typeof value === 'object' && value !== null;
}

function hasMessageLookup(channel: unknown): channel is MessageLookupChannel {
    if (typeof channel !== 'object' || channel === null) {
        return false;
    }

    const possibleChannel = channel as { messages?: { fetch?: unknown } };

    return typeof possibleChannel.messages?.fetch === 'function';
}
