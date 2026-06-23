import type { AppEnv, AppMode, GuildDefconOverride } from '@neonflux/config';
import { authorizeCommandAction, type DefconFeatureCategory } from '@neonflux/core/defcon';
import {
    findGuildSecurityPolicyByGuildId,
    listGuildDefconExemptionCategories,
    type DatabaseClient,
} from '@neonflux/db';
import { sendFluxerChannelMessage, type FluxerBot } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import {
    recordBotInstallationEvent,
    removeBotInstallationEvent,
    type BotInstallationSyncResult,
} from './bot-installation-sync.js';
import { shouldProcessBotGuildEvent } from './mode-gate.js';

export const DEFAULT_BOT_COMMAND_PREFIX = '!';

export const BOT_PRESENCE_FEATURE_CATEGORY = 'bot_mention' satisfies DefconFeatureCategory;

const PING_COMMAND_REPLY = "Yes, I'm here, and no, I don't pong";
const CONTEXTLESS_MENTION_REPLIES = [
    "I hate it when people think that saying someone's name just to see if they're there is proper communication. Just say what's on your mind please",
    "I don't appreciate being called for nothing",
    'I will no longer respond to that...',
] as const;
const CONTEXTLESS_MENTION_COOLDOWN_REPLY = "We've been here before... back to ignoring I suppose";
const CONTEXTLESS_MENTION_COOLDOWN_MS = 5 * 60 * 1000;
const contextlessMentionStateByActor = new Map<string, ContextlessMentionState>();

export type BotFeatureEvent =
    | {
          type: 'guild.lifecycle.created';
          guildId: string;
      }
    | {
          type: 'guild.lifecycle.deleted';
          guildId: string;
      }
    | {
          type: 'message.created';
          messageId: string;
          channelId: string;
          guildId: string | null;
          authorId: string;
          authorIsBot: boolean;
          content: string;
          mentionedUserIds: readonly string[];
      };

export type BotFeatureHandlerContext = {
    db: DatabaseClient['db'];
    mode: AppMode;
    appEnv: AppEnv;
    guildDefconOverride: GuildDefconOverride;
    client: FluxerBot['client'];
    botUserId?: string;
};

export type BotFeatureRouteIgnoredReason =
    | 'bot-authored-message'
    | 'bot-mentioned-with-context'
    | 'bot-not-mentioned'
    | 'bot-user-unavailable'
    | 'contextless-mention-cooldown'
    | 'defcon-denied'
    | 'guild-not-processable';

export type BotFeatureRouteResult =
    | {
          eventType: BotFeatureEvent['type'];
          status: 'handled';
      }
    | {
          eventType: BotFeatureEvent['type'];
          status: 'ignored';
          reason?: BotFeatureRouteIgnoredReason;
      };

export type BotFeatureRouteError = 'database-error' | 'handler-error' | 'message-send-error';

type BotPresenceIntent =
    | { type: 'contextless-mention' }
    | { type: 'ignored'; reason: BotFeatureRouteIgnoredReason }
    | { type: 'ping-command' };

type ContextlessMentionState = {
    replyCount: number;
    cooldownUntil?: number;
};

export async function routeBotFeatureEvent(
    context: BotFeatureHandlerContext,
    event: BotFeatureEvent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    try {
        switch (event.type) {
            case 'guild.lifecycle.created':
                return mapInstallationSyncResult(
                    await recordBotInstallationEvent(context.db, context.mode, { guildId: event.guildId }),
                    event.type
                );
            case 'guild.lifecycle.deleted':
                return mapInstallationSyncResult(
                    await removeBotInstallationEvent(context.db, context.mode, { guildId: event.guildId }),
                    event.type
                );
            case 'message.created':
                return await routeMessageCreatedEvent(context, event);
        }
    } catch {
        return err('handler-error');
    }
}

function mapInstallationSyncResult(
    result: Result<BotInstallationSyncResult, 'database-error'>,
    eventType: BotFeatureEvent['type']
): Result<BotFeatureRouteResult, BotFeatureRouteError> {
    if (result.isErr()) {
        return err(result.error);
    }

    switch (result.value.status) {
        case 'recorded':
        case 'removed':
            return ok({
                eventType,
                status: 'handled',
            });
        case 'ignored':
            return ok({
                eventType,
                status: 'ignored',
            });
    }
}

async function routeMessageCreatedEvent(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'message.created' }>
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const intent = getBotPresenceIntent(context, event);

    if (intent.type === 'ignored') {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: intent.reason,
        });
    }

    const authorizationResult = await authorizeBotPresenceReply(context, event);

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

    const content =
        intent.type === 'ping-command' ? PING_COMMAND_REPLY : getContextlessMentionReplyAndAdvance(event, Date.now());
    const result = await sendFluxerChannelMessage({
        client: context.client,
        channelId: event.channelId,
        content,
    });

    if (result.isErr()) {
        return err('message-send-error');
    }

    return ok({
        eventType: event.type,
        status: 'handled',
    });
}

function getBotPresenceIntent(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'message.created' }>
): BotPresenceIntent {
    if (event.authorIsBot) {
        return { type: 'ignored', reason: 'bot-authored-message' };
    }

    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return { type: 'ignored', reason: 'guild-not-processable' };
    }

    if (isPingCommand(event.content)) {
        return { type: 'ping-command' };
    }

    if (!context.botUserId) {
        return { type: 'ignored', reason: 'bot-user-unavailable' };
    }

    if (!event.mentionedUserIds.includes(context.botUserId)) {
        return { type: 'ignored', reason: 'bot-not-mentioned' };
    }

    if (getContentWithoutBotMention(event.content, context.botUserId).length > 0) {
        return { type: 'ignored', reason: 'bot-mentioned-with-context' };
    }

    if (isContextlessMentionCoolingDown(event, Date.now())) {
        return { type: 'ignored', reason: 'contextless-mention-cooldown' };
    }

    return { type: 'contextless-mention' };
}

async function authorizeBotPresenceReply(
    context: BotFeatureHandlerContext,
    event: { guildId: string | null; authorId: string }
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
            isServerOwner: false,
            hasManageServer: false,
        },
        category: BOT_PRESENCE_FEATURE_CATEGORY,
        audience: 'public',
        defconOneExemptCategories: exemptionCategoriesResult.value,
    });

    return ok(authorization.allowed);
}

function isPingCommand(content: string): boolean {
    return content.trim().toLowerCase() === `${DEFAULT_BOT_COMMAND_PREFIX}ping`;
}

function getContentWithoutBotMention(content: string, botUserId: string): string {
    const escapedBotUserId = escapeRegExp(botUserId);

    return content.replace(new RegExp(`<@!?${escapedBotUserId}>`, 'g'), ' ').trim();
}

function isContextlessMentionCoolingDown(
    event: Extract<BotFeatureEvent, { type: 'message.created' }>,
    nowMs: number
): boolean {
    const state = contextlessMentionStateByActor.get(createContextlessMentionStateKey(event));

    return state?.cooldownUntil !== undefined && nowMs < state.cooldownUntil;
}

function getContextlessMentionReplyAndAdvance(
    event: Extract<BotFeatureEvent, { type: 'message.created' }>,
    nowMs: number
): string {
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

function createContextlessMentionStateKey(event: Extract<BotFeatureEvent, { type: 'message.created' }>): string {
    return `${event.guildId ?? 'dm'}:${event.authorId}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
