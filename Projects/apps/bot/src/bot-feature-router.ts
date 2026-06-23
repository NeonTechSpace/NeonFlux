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

export const BOT_MENTION_FEATURE_CATEGORY = 'bot_mention' satisfies DefconFeatureCategory;

const BOT_MENTION_REPLY = "Yes, I'm here, and no, I don't pong";

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

export type BotFeatureRouteResult = {
    eventType: BotFeatureEvent['type'];
    status: 'handled' | 'ignored';
};

export type BotFeatureRouteError = 'database-error' | 'handler-error' | 'message-send-error';

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
    if (!shouldConsiderBotMentionReply(context, event)) {
        return ok({
            eventType: event.type,
            status: 'ignored',
        });
    }

    const authorizationResult = await authorizeBotMentionReply(context, event);

    if (authorizationResult.isErr()) {
        return err(authorizationResult.error);
    }

    if (!authorizationResult.value) {
        return ok({
            eventType: event.type,
            status: 'ignored',
        });
    }

    const result = await sendFluxerChannelMessage({
        client: context.client,
        channelId: event.channelId,
        content: BOT_MENTION_REPLY,
    });

    if (result.isErr()) {
        return err('message-send-error');
    }

    return ok({
        eventType: event.type,
        status: 'handled',
    });
}

function shouldConsiderBotMentionReply(
    context: BotFeatureHandlerContext,
    event: Extract<BotFeatureEvent, { type: 'message.created' }>
): boolean {
    if (event.authorIsBot || !context.botUserId) {
        return false;
    }

    if (!shouldProcessBotGuildEvent(context.mode, { guildId: event.guildId })) {
        return false;
    }

    return event.mentionedUserIds.includes(context.botUserId);
}

async function authorizeBotMentionReply(
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
        category: BOT_MENTION_FEATURE_CATEGORY,
        audience: 'public',
        defconOneExemptCategories: exemptionCategoriesResult.value,
    });

    return ok(authorization.allowed);
}
