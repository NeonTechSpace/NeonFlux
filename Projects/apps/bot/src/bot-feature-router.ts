import type { AppEnv, AppMode, GuildDefconOverride } from '@neonflux/config';
import { COMMAND_PREFIX_INVALID_MESSAGE, normalizeCommandPrefix } from '@neonflux/core/command-prefix';
import { authorizeCommandAction, type DefconFeatureCategory } from '@neonflux/core/defcon';
import {
    findGuildCommandPermissionRule,
    findGuildCommandSettingsByGuildId,
    findGuildSecurityPolicyByGuildId,
    listGuildDefconExemptionCategories,
    upsertGuildCommandPrefix,
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
export const PREFIX_COMMAND_FEATURE_CATEGORY = 'prefix' satisfies DefconFeatureCategory;

const PING_COMMAND_REPLY = "Yes, I'm here, and no, I don't pong";
const PREFIX_COMMAND_DENIED_REPLY =
    'You cannot change the prefix here. In lockdown, only the server owner can change guarded settings. Otherwise, this command requires Manage Server or an allowed role/user rule.';
const PREFIX_COMMAND_GUILD_ONLY_REPLY = 'I can only change the prefix inside a community.';
const PREFIX_COMMAND_INVALID_REPLY = COMMAND_PREFIX_INVALID_MESSAGE;
const PREFIX_COMMAND_USAGE_REPLY = 'Use: mention me with `prefix ?`.';
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
          authorRoleIds: readonly string[];
          authorIsServerOwner: boolean;
          authorHasManageServer: boolean;
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
    | { type: 'ping-command' }
    | { type: 'prefix-change-command'; rawPrefix: string | undefined };

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
    const intentResult = await getBotPresenceIntent(context, event);

    if (intentResult.isErr()) {
        return err(intentResult.error);
    }

    const intent = intentResult.value;

    if (intent.type === 'ignored') {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: intent.reason,
        });
    }

    if (intent.type === 'prefix-change-command') {
        return await routePrefixChangeCommand(context, event, intent.rawPrefix);
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

    return sendMessageAndMarkHandled(context, event, content);
}

async function getBotPresenceIntent(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'message.created' }>
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

async function authorizeBotPresenceReply(
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
        category: BOT_PRESENCE_FEATURE_CATEGORY,
        audience: 'public',
        defconOneExemptCategories: exemptionCategoriesResult.value,
    });

    return ok(authorization.allowed);
}

async function routePrefixChangeCommand(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'message.created' }>,
    rawPrefix: string | undefined
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!event.guildId) {
        return sendMessageAndMarkHandled(context, event, PREFIX_COMMAND_GUILD_ONLY_REPLY);
    }

    const authorizationResult = await authorizePrefixChange(context, event);

    if (authorizationResult.isErr()) {
        return err(authorizationResult.error);
    }

    if (!authorizationResult.value) {
        return sendMessageAndMarkHandled(context, event, PREFIX_COMMAND_DENIED_REPLY);
    }

    if (!rawPrefix) {
        return sendMessageAndMarkHandled(
            context,
            event,
            `${PREFIX_COMMAND_USAGE_REPLY} ${PREFIX_COMMAND_INVALID_REPLY}`
        );
    }

    const upsertResult = await upsertGuildCommandPrefix(context.db, {
        guildId: event.guildId,
        prefix: rawPrefix,
    });

    if (upsertResult.isErr()) {
        switch (upsertResult.error) {
            case 'invalid-prefix':
                return sendMessageAndMarkHandled(context, event, PREFIX_COMMAND_INVALID_REPLY);
            case 'missing-guild-id':
            case 'invalid-config':
            case 'not-found':
            case 'database-error':
                return err('database-error');
        }
    }

    return sendMessageAndMarkHandled(context, event, `Command prefix updated to \`${upsertResult.value.prefix}\`.`);
}

async function authorizePrefixChange(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'message.created' }>
): Promise<Result<boolean, 'database-error'>> {
    if (!event.guildId) {
        return ok(false);
    }

    const securityPolicyResult = await findGuildSecurityPolicyByGuildId(context.db, { guildId: event.guildId });

    if (securityPolicyResult.isErr() && securityPolicyResult.error !== 'not-found') {
        return err('database-error');
    }

    const commandGrantResult = await findGuildCommandPermissionRule(context.db, {
        guildId: event.guildId,
        category: PREFIX_COMMAND_FEATURE_CATEGORY,
    });

    if (commandGrantResult.isErr() && commandGrantResult.error !== 'not-found') {
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
        category: PREFIX_COMMAND_FEATURE_CATEGORY,
        audience: 'guarded',
        ...(commandGrantResult.isOk()
            ? {
                  commandGrant: {
                      userIds: commandGrantResult.value.userIds,
                      roleIds: commandGrantResult.value.roleIds,
                  },
              }
            : {}),
    });

    return ok(authorization.allowed);
}

async function isConfiguredPingCommand(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'message.created' }>
): Promise<Result<boolean, 'database-error'>> {
    if (!event.guildId) {
        return ok(false);
    }

    const candidatePrefix = parsePingCommandPrefix(event.content);

    if (!candidatePrefix) {
        return ok(false);
    }

    const settingsResult = await findGuildCommandSettingsByGuildId(context.db, { guildId: event.guildId });

    if (settingsResult.isErr() && settingsResult.error !== 'not-found') {
        return err('database-error');
    }

    const configuredPrefix = settingsResult.isOk() ? settingsResult.value.prefix : DEFAULT_BOT_COMMAND_PREFIX;

    return ok(candidatePrefix === configuredPrefix);
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

function getMentionedPrefixCommand(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'message.created' }>
): Extract<BotPresenceIntent, { type: 'prefix-change-command' }> | undefined {
    if (!context.botUserId || !event.mentionedUserIds.includes(context.botUserId)) {
        return undefined;
    }

    const contentWithoutMention = getContentWithoutBotMention(event.content, context.botUserId);
    const prefixMatch = /^prefix(?:\s+(.+))?$/iu.exec(contentWithoutMention);

    if (!prefixMatch) {
        return undefined;
    }

    return {
        type: 'prefix-change-command',
        rawPrefix: prefixMatch[1]?.trim(),
    };
}

async function sendMessageAndMarkHandled(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'message.created' }>,
    content: string
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
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
