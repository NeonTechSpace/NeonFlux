import { Client } from '@fluxerjs/core';
import { err, ok, type Result } from 'neverthrow';

import type { FluxerBot } from './client.js';
import { readFluxerGuildStructure } from './guild-structure.js';

export type RemoveFluxerChannelMessageReactionEmojiInput = {
    client: FluxerBot['client'];
    channelId: string;
    messageId: string;
    emoji: string;
};

export type RemoveFluxerGuildChannelMessageReactionEmojiInput = RemoveFluxerChannelMessageReactionEmojiInput & {
    guildId: string;
};

export type RemoveFluxerBotGuildChannelMessageReactionEmojiInput = Omit<
    RemoveFluxerGuildChannelMessageReactionEmojiInput,
    'client'
> & {
    botToken: string;
};

export type RemoveFluxerChannelMessageReactionEmojiError =
    | { type: 'missing-input'; field: 'channelId' | 'messageId' | 'emoji' }
    | { type: 'unsupported'; feature: 'message-reaction-emoji-removal' }
    | { type: 'remove-reaction-failed'; error: unknown };

export type RemoveFluxerGuildChannelMessageReactionEmojiError =
    | RemoveFluxerChannelMessageReactionEmojiError
    | { type: 'missing-input'; field: 'guildId' }
    | { type: 'channel-not-in-guild' }
    | { type: 'guild-lookup-failed'; error?: unknown };

export type RemoveFluxerBotGuildChannelMessageReactionEmojiError =
    | RemoveFluxerGuildChannelMessageReactionEmojiError
    | { type: 'missing-input'; field: 'botToken' }
    | { type: 'login-failed'; error: unknown };

type ReactionEmojiManageableMessageChannel = {
    messages: {
        fetch(messageId: string): Promise<{
            removeReactionEmoji?(emoji: string): Promise<void>;
        }>;
    };
};

export async function removeFluxerBotGuildChannelMessageReactionEmoji(
    input: RemoveFluxerBotGuildChannelMessageReactionEmojiInput
): Promise<Result<void, RemoveFluxerBotGuildChannelMessageReactionEmojiError>> {
    const botToken = input.botToken.trim();

    if (!botToken) {
        return err({ type: 'missing-input', field: 'botToken' });
    }

    const client = new Client({ gatewayDebug: false });

    try {
        await client.login(botToken);

        return await removeFluxerGuildChannelMessageReactionEmoji({
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

export async function removeFluxerGuildChannelMessageReactionEmoji(
    input: RemoveFluxerGuildChannelMessageReactionEmojiInput
): Promise<Result<void, RemoveFluxerGuildChannelMessageReactionEmojiError>> {
    const guildId = input.guildId.trim();
    const channelId = input.channelId.trim();

    if (!guildId) {
        return err({ type: 'missing-input', field: 'guildId' });
    }

    const structureResult = await readFluxerGuildStructure({ client: input.client, guildId });

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

    return removeFluxerChannelMessageReactionEmoji(input);
}

export async function removeFluxerChannelMessageReactionEmoji(
    input: RemoveFluxerChannelMessageReactionEmojiInput
): Promise<Result<void, RemoveFluxerChannelMessageReactionEmojiError>> {
    const channelId = input.channelId.trim();
    const messageId = input.messageId.trim();
    const emoji = input.emoji.trim();

    if (!channelId) return err({ type: 'missing-input', field: 'channelId' });
    if (!messageId) return err({ type: 'missing-input', field: 'messageId' });
    if (!emoji) return err({ type: 'missing-input', field: 'emoji' });

    try {
        const channel = await input.client.channels.resolve(channelId);

        if (!isReactionEmojiManageableMessageChannel(channel)) {
            return err({ type: 'remove-reaction-failed', error: new Error('Message channel is not fetchable.') });
        }

        const message = await channel.messages.fetch(messageId);

        if (typeof message.removeReactionEmoji !== 'function') {
            return err({ type: 'unsupported', feature: 'message-reaction-emoji-removal' });
        }

        await message.removeReactionEmoji(emoji);

        return ok(undefined);
    } catch (error) {
        return err({ type: 'remove-reaction-failed', error });
    }
}

function isReactionEmojiManageableMessageChannel(channel: unknown): channel is ReactionEmojiManageableMessageChannel {
    if (typeof channel !== 'object' || channel === null) {
        return false;
    }

    const possibleChannel = channel as { messages?: { fetch?: unknown } };

    return typeof possibleChannel.messages?.fetch === 'function';
}
