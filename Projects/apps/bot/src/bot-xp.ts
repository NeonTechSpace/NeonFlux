import { findBotCommandDefinition, type BotCommandDefinition } from '@neonflux/core';
import { normalizeCommandPrefix } from '@neonflux/core/command-prefix';
import {
    closeXpVoiceSession,
    findGuildUserXpRank,
    findXpSettingsByGuildId,
    grantGuildUserXp,
    listGuildXpLeaderboard,
    transitionXpVoiceSession,
    type ClosedXpVoiceSession,
    type XpSettingsRecord,
} from '@neonflux/db';
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
import { shouldProcessBotGuildEvent } from './mode-gate.js';

type XpCommandName = 'rank' | 'leaderboard';
type XpCommandId = 'xp.rank' | 'xp.leaderboard';
type XpCommandIntent = {
    commandName: XpCommandName;
    commandId: XpCommandId;
    effectivePrefix: string;
    argumentsText: string;
};

type XpTrackingResult =
    | { status: 'awarded'; action: BotFeatureRouteHandledAction }
    | { status: 'ignored'; reason?: 'no-feature-handler' | 'guild-not-processable' };

const xpCommandSpecs = [
    { commandName: 'leaderboard', commandId: 'xp.leaderboard' },
    { commandName: 'rank', commandId: 'xp.rank' },
] as const satisfies ReadonlyArray<{ commandName: XpCommandName; commandId: XpCommandId }>;

export async function getXpCommandIntent(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<XpCommandIntent | undefined, 'database-error'>> {
    if (!event.guildId) {
        return ok(undefined);
    }

    const candidate = parsePotentialPrefixedXpCommand(event.content);

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
        commandName: candidate.commandName,
        commandId: candidate.commandId,
        effectivePrefix: prefixResult.value,
        argumentsText: candidate.argumentsText,
    });
}

export async function routeXpCommand(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: XpCommandIntent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const command = getCommandDefinition(intent.commandId);
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

    switch (intent.commandName) {
        case 'rank':
            return replyWithRank(context, event, intent);
        case 'leaderboard':
            return replyWithLeaderboard(context, event);
    }
}

export async function trackXpMessageActivity(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<XpTrackingResult, BotFeatureRouteError>> {
    if (!event.guildId || !shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    const settingsResult = await loadEnabledXpSettings(context, event.guildId);

    if (settingsResult.isErr()) {
        return err(settingsResult.error);
    }

    if (!settingsResult.value) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const rankResult = await findGuildUserXpRank(context.db, {
        guildId: event.guildId,
        userId: event.authorId,
    });

    if (rankResult.isErr() && rankResult.error.type !== 'not-found') {
        return err('database-error');
    }

    if (
        rankResult.isOk() &&
        rankResult.value.userXp.lastMessageXpAt &&
        isMessageXpCoolingDown(rankResult.value.userXp.lastMessageXpAt, settingsResult.value.cooldownSeconds)
    ) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const xp = calculateMessageXp(settingsResult.value, event.messageId);
    const grantResult = await grantGuildUserXp(context.db, {
        guildId: event.guildId,
        userId: event.authorId,
        source: 'message',
        xp,
        idempotencyKey: `message:${event.messageId}`,
        metadata: {
            channelId: event.channelId,
            messageId: event.messageId,
        },
    });

    if (grantResult.isErr()) {
        return err('database-error');
    }

    return ok(
        grantResult.value.status === 'granted'
            ? { status: 'awarded', action: 'event.xp.message_awarded' }
            : { status: 'ignored', reason: 'no-feature-handler' }
    );
}

export async function trackXpVoiceStateUpdate(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'voice_state.updated' }>
): Promise<Result<XpTrackingResult, BotFeatureRouteError>> {
    if (!event.guildId || !event.userId || !shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    const settingsResult = await loadEnabledXpSettings(context, event.guildId);

    if (settingsResult.isErr()) {
        return err(settingsResult.error);
    }

    if (!settingsResult.value) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    if (event.channelId) {
        const transitionResult = await transitionXpVoiceSession(context.db, {
            guildId: event.guildId,
            userId: event.userId,
            channelId: event.channelId,
        });

        if (transitionResult.isErr()) {
            return err('database-error');
        }

        if (transitionResult.value.status !== 'started' || !transitionResult.value.closed) {
            return ok({ status: 'ignored', reason: 'no-feature-handler' });
        }

        return awardClosedVoiceSession(
            context,
            event.guildId,
            event.userId,
            settingsResult.value,
            transitionResult.value.closed
        );
    }

    const closeResult = await closeXpVoiceSession(context.db, {
        guildId: event.guildId,
        userId: event.userId,
    });

    if (closeResult.isErr()) {
        return closeResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    return awardClosedVoiceSession(context, event.guildId, event.userId, settingsResult.value, closeResult.value);
}

function parsePotentialPrefixedXpCommand(
    content: string
): { commandName: XpCommandName; commandId: XpCommandId; candidatePrefix: string; argumentsText: string } | undefined {
    const normalizedContent = content.trim();
    const lowerContent = normalizedContent.toLowerCase();

    for (const spec of xpCommandSpecs) {
        const commandIndex = lowerContent.indexOf(spec.commandName);

        if (commandIndex < 1 || commandIndex > 3) {
            continue;
        }

        const trailingContent = normalizedContent.slice(commandIndex + spec.commandName.length);

        if (trailingContent.length > 0 && !/^\s/u.test(trailingContent)) {
            continue;
        }

        const prefixResult = normalizeCommandPrefix(normalizedContent.slice(0, commandIndex));

        if (prefixResult.isErr()) {
            continue;
        }

        return {
            commandName: spec.commandName,
            commandId: spec.commandId,
            candidatePrefix: prefixResult.value,
            argumentsText: trailingContent.trim(),
        };
    }

    return undefined;
}

async function replyWithRank(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    intent: XpCommandIntent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    const parsedTargetUserId = parseOptionalUserArgument(intent.argumentsText);
    const targetUserId = parsedTargetUserId === undefined ? event.authorId : parsedTargetUserId;

    if (!targetUserId || !event.guildId) {
        return sendBotFeatureReply(
            context,
            event,
            `Usage: ${getCommandDefinition('xp.rank').usage(intent.effectivePrefix)}`,
            'command.xp.rank'
        );
    }

    const rankResult = await findGuildUserXpRank(context.db, {
        guildId: event.guildId,
        userId: targetUserId,
    });

    if (rankResult.isErr()) {
        return rankResult.error.type === 'not-found'
            ? sendBotFeatureReply(context, event, `No XP recorded for <@${targetUserId}> yet.`, 'command.xp.rank')
            : err('database-error');
    }

    const { userXp, rank } = rankResult.value;

    return sendBotFeatureReply(
        context,
        event,
        [
            `XP rank for <@${targetUserId}>`,
            `Rank: #${String(rank)}`,
            `Level: ${String(userXp.level)}`,
            `Total XP: ${String(userXp.xp)} (${String(userXp.messageXp)} message, ${String(userXp.voiceXp)} voice)`,
        ].join('\n'),
        'command.xp.rank'
    );
}

async function replyWithLeaderboard(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!event.guildId) {
        return ok({
            eventType: event.type,
            status: 'ignored',
            reason: 'guild-not-processable',
        });
    }

    const leaderboardResult = await listGuildXpLeaderboard(context.db, {
        guildId: event.guildId,
        limit: 10,
    });

    if (leaderboardResult.isErr()) {
        return err('database-error');
    }

    const content =
        leaderboardResult.value.length === 0
            ? 'No XP leaderboard yet. XP starts once dashboard XP rules are enabled.'
            : [
                  'XP leaderboard',
                  ...leaderboardResult.value.map(
                      (entry, index) =>
                          `#${String(index + 1)} <@${entry.userId}> - ${String(entry.xp)} XP, level ${String(entry.level)}`
                  ),
              ].join('\n');

    return sendBotFeatureReply(context, event, content, 'command.xp.leaderboard');
}

async function loadEnabledXpSettings(
    context: BotFeatureHandlerContext,
    guildId: string
): Promise<Result<XpSettingsRecord | undefined, BotFeatureRouteError>> {
    const settingsResult = await findXpSettingsByGuildId(context.db, { guildId });

    if (settingsResult.isErr()) {
        return settingsResult.error.type === 'not-found' ? ok(undefined) : err('database-error');
    }

    return ok(settingsResult.value.enabled ? settingsResult.value : undefined);
}

async function awardClosedVoiceSession(
    context: BotFeatureHandlerContext,
    guildId: string,
    userId: string,
    settings: XpSettingsRecord,
    closed: ClosedXpVoiceSession
): Promise<Result<XpTrackingResult, BotFeatureRouteError>> {
    const creditedMinutes = Math.floor(closed.durationSeconds / 60);

    if (creditedMinutes < settings.voiceMinimumMinutes || settings.voiceXpPerMinute <= 0) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const xp = creditedMinutes * settings.voiceXpPerMinute;
    const grantResult = await grantGuildUserXp(context.db, {
        guildId,
        userId,
        source: 'voice',
        xp,
        voiceSeconds: closed.durationSeconds,
        idempotencyKey: `voice:${closed.session.id}`,
        metadata: {
            channelId: closed.session.channelId,
            sessionId: closed.session.id,
            durationSeconds: closed.durationSeconds,
        },
    });

    if (grantResult.isErr()) {
        return err('database-error');
    }

    return ok(
        grantResult.value.status === 'granted'
            ? { status: 'awarded', action: 'event.xp.voice_awarded' }
            : { status: 'ignored', reason: 'no-feature-handler' }
    );
}

function calculateMessageXp(settings: XpSettingsRecord, messageId: string): number {
    const span = settings.messageXpMax - settings.messageXpMin;

    if (span <= 0) {
        return settings.messageXpMin;
    }

    return settings.messageXpMin + (hashText(messageId) % (span + 1));
}

function hashText(value: string): number {
    let hash = 2166136261;

    for (const character of value) {
        hash ^= character.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function isMessageXpCoolingDown(lastMessageXpAt: Date, cooldownSeconds: number): boolean {
    return Date.now() - lastMessageXpAt.getTime() < cooldownSeconds * 1000;
}

function parseOptionalUserArgument(argumentsText: string): string | undefined | null {
    const trimmed = argumentsText.trim();

    if (!trimmed) {
        return undefined;
    }

    const mentionMatch = /^<@!?([A-Za-z0-9_-]+)>$/u.exec(trimmed);

    return mentionMatch?.[1] ?? (/^[A-Za-z0-9_-]+$/u.test(trimmed) ? trimmed : null);
}

function getCommandDefinition(commandId: XpCommandId): BotCommandDefinition {
    const command = findBotCommandDefinition(commandId);

    if (!command) {
        throw new Error(`Missing XP command definition: ${commandId}`);
    }

    return command;
}
