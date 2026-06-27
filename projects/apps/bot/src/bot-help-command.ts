import { normalizeCommandPrefix } from '@neonflux/core/command-prefix';
import { DEFCON_FEATURE_CATEGORY } from '@neonflux/core/defcon';
import { err, ok, type Result } from 'neverthrow';

import { authorizeBotCommand } from './bot-command-authorization.js';
import { sendBotFeatureReply } from './bot-feature-replies.js';
import type {
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteResult,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';
import { getContentWithoutBotMention } from './bot-prefix-command.js';
import { getVisibleHelpCategories } from './bot-feature-registry.js';
import { findEffectiveGuildCommandPrefix } from './guild-command-prefix.js';

const HELP_COMMAND_ACTION = 'command.help';
export type HelpCommandIntent = {
    type: 'help-command';
    rawTopic?: string;
    effectivePrefix?: string;
};

export async function getHelpCommandIntent(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<HelpCommandIntent | undefined, 'database-error'>> {
    const mentionedHelpCommand = getMentionedHelpCommand(context, event);

    if (mentionedHelpCommand) {
        return ok(mentionedHelpCommand);
    }

    if (!event.guildId) {
        return ok(undefined);
    }

    const prefixedHelpCommand = parsePotentialPrefixedHelpCommand(event.content);

    if (!prefixedHelpCommand) {
        return ok(undefined);
    }

    const prefixResult = await findEffectiveGuildCommandPrefix(context, event.guildId);

    if (prefixResult.isErr()) {
        return err(prefixResult.error);
    }

    if (prefixedHelpCommand.candidatePrefix !== prefixResult.value) {
        return ok(undefined);
    }

    return ok({
        type: 'help-command',
        effectivePrefix: prefixResult.value,
        ...(prefixedHelpCommand.rawTopic ? { rawTopic: prefixedHelpCommand.rawTopic } : {}),
    });
}

export async function routeHelpCommand(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: HelpCommandIntent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!event.guildId) {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'guild-not-processable',
        });
    }

    const authorizationResult = await authorizeHelpCommand(context, event);

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

    const prefixResult = intent.effectivePrefix
        ? ok(intent.effectivePrefix)
        : await findEffectiveGuildCommandPrefix(context, event.guildId);

    if (prefixResult.isErr()) {
        return err(prefixResult.error);
    }

    return sendBotFeatureReply(
        context,
        event,
        createHelpReply(prefixResult.value, intent.rawTopic),
        HELP_COMMAND_ACTION
    );
}

function getMentionedHelpCommand(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): HelpCommandIntent | undefined {
    if (!context.botUserId || !event.mentionedUserIds.includes(context.botUserId)) {
        return undefined;
    }

    const contentWithoutMention = getContentWithoutBotMention(event.content, context.botUserId);
    const helpMatch = /^help(?:\s+(.+))?$/iu.exec(contentWithoutMention);

    if (!helpMatch) {
        return undefined;
    }

    const rawTopic = helpMatch.at(1)?.trim();

    return {
        type: 'help-command',
        ...(rawTopic ? { rawTopic } : {}),
    };
}

function parsePotentialPrefixedHelpCommand(
    content: string
): { candidatePrefix: string; rawTopic?: string } | undefined {
    const normalizedContent = content.trim();
    const helpIndex = normalizedContent.toLowerCase().indexOf('help');

    if (helpIndex < 1) {
        return undefined;
    }

    const candidatePrefix = normalizedContent.slice(0, helpIndex);
    const candidatePrefixLength = Array.from(candidatePrefix).length;

    if (candidatePrefixLength < 1 || candidatePrefixLength > 3) {
        return undefined;
    }

    const trailingContent = normalizedContent.slice(helpIndex + 'help'.length);

    if (trailingContent.length > 0 && !/^\s/u.test(trailingContent)) {
        return undefined;
    }

    const prefixResult = normalizeCommandPrefix(candidatePrefix);

    if (prefixResult.isErr()) {
        return undefined;
    }

    const rawTopic = trailingContent.trim();

    return {
        candidatePrefix: prefixResult.value,
        ...(rawTopic ? { rawTopic } : {}),
    };
}

async function authorizeHelpCommand(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<boolean, 'database-error'>> {
    if (!event.guildId) {
        return ok(false);
    }

    return await authorizeBotCommand(context, event, {
        commandId: 'general.help',
        categoryId: 'general',
        defconCategory: DEFCON_FEATURE_CATEGORY.help,
        audience: 'public',
    });
}

function createHelpReply(prefix: string, rawTopic: string | undefined): string {
    const topic = normalizeHelpTopic(rawTopic);
    const categories = getVisibleHelpCategories(prefix);

    if (!topic) {
        return [
            'NeonFlux help',
            `Use \`${prefix}help general\` or \`${prefix}help settings\` for command pages.`,
            '',
            ...categories.map(
                (category) =>
                    `${category.title}: ${category.commands.map((command) => `\`${command.usage}\``).join(', ')}`
            ),
        ].join('\n');
    }

    const category = findHelpCategory(categories, topic);

    if (!category) {
        return [`Unknown help page \`${topic}\`.`, `Try \`${prefix}help general\` or \`${prefix}help settings\`.`].join(
            '\n'
        );
    }

    return [
        `NeonFlux help: ${category.title}`,
        ...category.commands.map((command) => `- \`${command.usage}\` - ${command.description}`),
    ].join('\n');
}

function normalizeHelpTopic(rawTopic: string | undefined): string | undefined {
    const topic = rawTopic?.trim().toLowerCase();

    return topic && topic.length > 0 ? topic : undefined;
}

function findHelpCategory(categories: ReturnType<typeof getVisibleHelpCategories>, categoryId: string) {
    return categories.find((category) => category.id === categoryId);
}
