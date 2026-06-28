import '@tanstack/react-start/server-only';

import { reactFluxerBotGuildChannelMessage, removeFluxerBotGuildChannelMessageReactionEmoji } from '@neonflux/fluxer';

export async function seedDashboardReactionRoleOptionReactions(input: {
    botToken: string;
    guildId: string;
    channelId: string;
    messageId: string;
    emojiKeys: string[];
}): Promise<string[]> {
    const failures: string[] = [];

    for (const emoji of input.emojiKeys) {
        const result = await reactFluxerBotGuildChannelMessage({
            botToken: input.botToken,
            guildId: input.guildId,
            channelId: input.channelId,
            messageId: input.messageId,
            emoji,
        });

        if (result.isErr()) {
            failures.push(emoji);
        }
    }

    return failures;
}

export async function removeDashboardReactionRoleOptionReaction(input: {
    botToken: string;
    guildId: string;
    channelId: string;
    messageId: string;
    emojiKey: string;
}): Promise<string[]> {
    const result = await removeFluxerBotGuildChannelMessageReactionEmoji({
        botToken: input.botToken,
        guildId: input.guildId,
        channelId: input.channelId,
        messageId: input.messageId,
        emoji: input.emojiKey,
    });

    return result.isOk() ? [] : [input.emojiKey];
}
