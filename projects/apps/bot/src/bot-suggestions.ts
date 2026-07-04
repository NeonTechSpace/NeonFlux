import { findBotCommandDefinition, type BotCommandDefinition } from '@neonflux/core';
import { normalizeCommandPrefix } from '@neonflux/core/command-prefix';
import {
    createSuggestion,
    deleteSuggestionVote,
    findDefaultSuggestionBoardByGuildId,
    findSuggestionByGuildMessageId,
    upsertSuggestionVote,
} from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import { authorizeBotCommand } from './bot-command-authorization.js';
import { sendBotFeatureReply } from './bot-feature-replies.js';
import type {
    BotFeatureEvent,
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteHandledAction,
    BotFeatureRouteResult,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';
import { findEffectiveGuildCommandPrefix } from './guild-command-prefix.js';

type SuggestionCommandIntent = {
    effectivePrefix: string;
    content: string;
};

type SuggestionReactionResult =
    | { status: 'applied'; action: BotFeatureRouteHandledAction }
    | { status: 'ignored'; reason: 'no-feature-handler' | 'guild-not-processable' };

type BotSuggestionReactionEvent = Extract<BotFeatureEvent, { emojiKey: string }> & {
    type: 'reaction.added' | 'reaction.removed';
};

const suggestionCommandId = 'suggestions.suggest';
const upvoteEmoji = '✅';
const downvoteEmoji = '❌';
const suggestionVoteEmojiKeys = new Map<string, 'up' | 'down'>([
    ['✅', 'up'],
    ['unicode:✅', 'up'],
    ['❌', 'down'],
    ['unicode:❌', 'down'],
]);

export async function getSuggestionCommandIntent(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<SuggestionCommandIntent | undefined, 'database-error'>> {
    if (!event.guildId) {
        return ok(undefined);
    }

    const candidate = parsePotentialSuggestionCommand(event.content);

    if (!candidate) {
        return ok(undefined);
    }

    const prefixResult = await findEffectiveGuildCommandPrefix(context, event.guildId);

    if (prefixResult.isErr()) {
        return err(prefixResult.error);
    }

    if (candidate.candidatePrefix !== prefixResult.value) {
        return ok(undefined);
    }

    return ok({
        effectivePrefix: prefixResult.value,
        content: candidate.content,
    });
}

export async function routeSuggestionCommand(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: SuggestionCommandIntent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!event.guildId) {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'guild-not-processable',
        });
    }

    const command = getCommandDefinition();
    const authorizationResult = await authorizeBotCommand(context, event, {
        commandId: command.id,
        categoryId: command.categoryId,
        defconCategory: command.defconCategory,
        audience: command.audience,
    });

    if (authorizationResult.isErr()) {
        return err(authorizationResult.error);
    }

    if (!authorizationResult.value) {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'defcon-denied',
        });
    }

    if (!intent.content) {
        return sendBotFeatureReply(
            context,
            event,
            `Usage: ${command.usage(intent.effectivePrefix)}`,
            'command.suggestions.suggest'
        );
    }

    const boardResult = await findDefaultSuggestionBoardByGuildId(context.db, {
        guildId: event.guildId,
    });

    if (boardResult.isErr()) {
        if (boardResult.error.type !== 'not-found') {
            return err('database-error');
        }

        return sendBotFeatureReply(
            context,
            event,
            'Suggestions are not configured for this server yet.',
            'command.suggestions.suggest'
        );
    }

    const platform = createFluxerPlatform(context.client);
    const sendResult = await platform.messages.send({
        channelId: boardResult.value.channelId,
        embeds: [
            {
                title: 'Suggestion',
                description: intent.content,
                color: 0x12d8c4,
                footer: {
                    text: `Submitted by ${event.authorId}`,
                },
            },
        ],
    });

    if (sendResult.isErr()) {
        return err('message-send-error');
    }

    const suggestionResult = await createSuggestion(context.db, {
        guildId: event.guildId,
        boardId: boardResult.value.id,
        channelId: sendResult.value.channelId,
        messageId: sendResult.value.id,
        authorUserId: event.authorId,
        content: intent.content,
    });

    if (suggestionResult.isErr()) {
        return err('database-error');
    }

    await addSuggestionVoteReactions(platform, {
        channelId: sendResult.value.channelId,
        messageId: sendResult.value.id,
    });

    return sendBotFeatureReply(
        context,
        event,
        `Suggestion submitted to <#${boardResult.value.channelId}>.`,
        'command.suggestions.suggest'
    );
}

export async function routeSuggestionReactionEvent(
    context: BotFeatureHandlerContext,
    event: BotSuggestionReactionEvent
): Promise<Result<SuggestionReactionResult, BotFeatureRouteError>> {
    if (!event.guildId) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    if (context.botUserId && event.userId === context.botUserId) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const vote = suggestionVoteEmojiKeys.get(event.emojiKey);

    if (!vote) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const suggestionResult = await findSuggestionByGuildMessageId(context.db, {
        guildId: event.guildId,
        messageId: event.messageId,
    });

    if (suggestionResult.isErr()) {
        return suggestionResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    if (event.type === 'reaction.removed') {
        const deleteResult = await deleteSuggestionVote(context.db, {
            suggestionId: suggestionResult.value.id,
            userId: event.userId,
        });

        if (deleteResult.isErr() && deleteResult.error.type !== 'not-found') {
            return err('database-error');
        }

        return ok({ status: 'applied', action: 'event.suggestions.vote_removed' });
    }

    const voteResult = await upsertSuggestionVote(context.db, {
        suggestionId: suggestionResult.value.id,
        userId: event.userId,
        vote,
    });

    if (voteResult.isErr()) {
        return err('database-error');
    }

    return ok({ status: 'applied', action: 'event.suggestions.vote_updated' });
}

function parsePotentialSuggestionCommand(content: string): { candidatePrefix: string; content: string } | undefined {
    const normalizedContent = content.trim();
    const lowerContent = normalizedContent.toLowerCase();
    const commandIndex = lowerContent.indexOf('suggest');

    if (commandIndex < 1 || commandIndex > 3) {
        return undefined;
    }

    const trailingContent = normalizedContent.slice(commandIndex + 'suggest'.length);

    if (trailingContent.length > 0 && !/^\s/u.test(trailingContent)) {
        return undefined;
    }

    const prefixResult = normalizeCommandPrefix(normalizedContent.slice(0, commandIndex));

    if (prefixResult.isErr()) {
        return undefined;
    }

    return {
        candidatePrefix: prefixResult.value,
        content: trailingContent.trim(),
    };
}

async function addSuggestionVoteReactions(
    platform: ReturnType<typeof createFluxerPlatform>,
    input: { channelId: string; messageId: string }
): Promise<void> {
    for (const emoji of [upvoteEmoji, downvoteEmoji]) {
        const result = await platform.messages.react({
            channelId: input.channelId,
            messageId: input.messageId,
            emoji,
        });

        if (result.isErr()) {
            return;
        }
    }
}

function getCommandDefinition(): BotCommandDefinition {
    const command = findBotCommandDefinition(suggestionCommandId);

    if (!command) {
        throw new Error(`Missing suggestion command definition: ${suggestionCommandId}`);
    }

    return command;
}
