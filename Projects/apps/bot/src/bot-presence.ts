import { normalizeCommandPrefix } from '@neonflux/core/command-prefix';
import { authorizeCommandAction, DEFCON_FEATURE_CATEGORY } from '@neonflux/core/defcon';
import { findGuildSecurityPolicyByGuildId, listGuildDefconExemptionCategories } from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import type {
    BotFeatureHandlerContext,
    BotFeatureRouteIgnoredReason,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';
import {
    getContentWithoutBotMention,
    getMentionedPrefixCommand,
    type PrefixChangeCommandIntent,
} from './bot-prefix-command.js';
import { findEffectiveGuildCommandPrefix } from './guild-command-prefix.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';

const PING_COMMAND_REPLY = "Yes, I'm here, and no, I don't pong";
const CONTEXTLESS_MENTION_REPLIES = [
    "I predominantly dislike it when people think that saying someone's name just to see if they're there is proper communication. Just say what's on your mind please",
    "I don't appreciate being called for nothing",
    'I will no longer respond to that...',
] as const;
const CONTEXTLESS_MENTION_COOLDOWN_REPLY = "We've been here before... back to ignoring I suppose";
const CONTEXTLESS_MENTION_COOLDOWN_MS = 5 * 60 * 1000;
const contextlessMentionStateByActor = new Map<string, ContextlessMentionState>();

export type BotPresenceIntent =
    | { type: 'contextless-mention' }
    | { type: 'ignored'; reason: BotFeatureRouteIgnoredReason }
    | { type: 'ping-command' }
    | PrefixChangeCommandIntent;

type ContextlessMentionState = {
    replyCount: number;
    cooldownUntil?: number;
};

export async function getBotPresenceIntent(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<BotPresenceIntent, 'database-error'>> {
    if (event.authorIsBot) {
        return ok({ type: 'ignored', reason: 'bot-authored-message' });
    }

    const prefixChangeCommand = getMentionedPrefixCommand(context, event);

    if (prefixChangeCommand && !event.guildId) {
        return ok(prefixChangeCommand);
    }

    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({ type: 'ignored', reason: 'guild-not-processable' });
    }

    if (prefixChangeCommand) {
        return ok(prefixChangeCommand);
    }

    const pingCommandResult = await isConfiguredPingCommand(context, event);

    if (pingCommandResult.isErr()) {
        return err(pingCommandResult.error);
    }

    if (pingCommandResult.value) {
        return ok({ type: 'ping-command' });
    }

    if (!context.botUserId) {
        return ok({ type: 'ignored', reason: 'bot-user-unavailable' });
    }

    if (!event.mentionedUserIds.includes(context.botUserId)) {
        return ok({ type: 'ignored', reason: 'bot-not-mentioned' });
    }

    if (getContentWithoutBotMention(event.content, context.botUserId).length > 0) {
        return ok({ type: 'ignored', reason: 'bot-mentioned-with-context' });
    }

    if (isContextlessMentionCoolingDown(event, Date.now())) {
        return ok({ type: 'ignored', reason: 'contextless-mention-cooldown' });
    }

    return ok({ type: 'contextless-mention' });
}

export async function authorizeBotPresenceReply(
    context: BotFeatureHandlerContext,
    event: {
        guildId: string | null;
        authorId: string;
        authorRoleIds: readonly string[];
        authorIsServerOwner: boolean;
        authorHasManageServer: boolean;
    }
): Promise<Result<boolean, 'database-error'>> {
    if (!event.guildId) {
        return ok(false);
    }

    const securityPolicyResult = await findGuildSecurityPolicyByGuildId(context.db, { guildId: event.guildId });

    if (securityPolicyResult.isErr() && securityPolicyResult.error !== 'not-found') {
        return err('database-error');
    }

    const exemptionCategoriesResult = await listGuildDefconExemptionCategories(context.db, { guildId: event.guildId });

    if (exemptionCategoriesResult.isErr()) {
        return err('database-error');
    }

    const storedLevel = securityPolicyResult.isOk() ? securityPolicyResult.value.defconLevel : undefined;
    const authorization = authorizeCommandAction({
        appEnv: context.appEnv,
        override: context.guildDefconOverride,
        ...(storedLevel ? { storedLevel } : {}),
        actor: {
            userId: event.authorId,
            roleIds: event.authorRoleIds,
            isServerOwner: event.authorIsServerOwner,
            hasManageServer: event.authorHasManageServer,
        },
        category: DEFCON_FEATURE_CATEGORY.botMention,
        audience: 'public',
        defconOneExemptCategories: exemptionCategoriesResult.value,
    });

    return ok(authorization.allowed);
}

export function getBotPresenceReply(event: BotMessageCreatedEvent, intent: BotPresenceIntent): string {
    switch (intent.type) {
        case 'ping-command':
            return PING_COMMAND_REPLY;

        case 'contextless-mention':
            return getContextlessMentionReplyAndAdvance(event, Date.now());

        case 'ignored':
        case 'prefix-change-command':
            throw new Error(`Cannot create a presence reply for intent: ${intent.type}`);
    }
}

async function isConfiguredPingCommand(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<boolean, 'database-error'>> {
    if (!event.guildId) {
        return ok(false);
    }

    const candidatePrefix = parsePingCommandPrefix(event.content);

    if (!candidatePrefix) {
        return ok(false);
    }

    const prefixResult = await findEffectiveGuildCommandPrefix(context, event.guildId);

    if (prefixResult.isErr()) {
        return err(prefixResult.error);
    }

    return ok(candidatePrefix === prefixResult.value);
}

function parsePingCommandPrefix(content: string): string | undefined {
    const normalizedContent = content.trim();
    const lowerContent = normalizedContent.toLowerCase();

    if (!lowerContent.endsWith('ping')) {
        return undefined;
    }

    const candidatePrefix = normalizedContent.slice(0, -'ping'.length);
    const prefixResult = normalizeCommandPrefix(candidatePrefix);

    if (prefixResult.isErr()) {
        return undefined;
    }

    return prefixResult.value;
}

function isContextlessMentionCoolingDown(event: BotMessageCreatedEvent, nowMs: number): boolean {
    const state = contextlessMentionStateByActor.get(createContextlessMentionStateKey(event));

    return state?.cooldownUntil !== undefined && nowMs < state.cooldownUntil;
}

function getContextlessMentionReplyAndAdvance(event: BotMessageCreatedEvent, nowMs: number): string {
    const key = createContextlessMentionStateKey(event);
    const state = contextlessMentionStateByActor.get(key) ?? { replyCount: 0 };

    if (state.replyCount < CONTEXTLESS_MENTION_REPLIES.length) {
        const reply = CONTEXTLESS_MENTION_REPLIES[state.replyCount] ?? CONTEXTLESS_MENTION_COOLDOWN_REPLY;
        const replyCount = state.replyCount + 1;

        contextlessMentionStateByActor.set(key, {
            replyCount,
            ...(replyCount >= CONTEXTLESS_MENTION_REPLIES.length
                ? { cooldownUntil: nowMs + CONTEXTLESS_MENTION_COOLDOWN_MS }
                : {}),
        });

        return reply;
    }

    contextlessMentionStateByActor.set(key, {
        replyCount: state.replyCount,
        cooldownUntil: nowMs + CONTEXTLESS_MENTION_COOLDOWN_MS,
    });

    return CONTEXTLESS_MENTION_COOLDOWN_REPLY;
}

function createContextlessMentionStateKey(event: BotMessageCreatedEvent): string {
    return `${event.guildId ?? 'dm'}:${event.authorId}`;
}
