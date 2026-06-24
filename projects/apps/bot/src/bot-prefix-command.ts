import { COMMAND_PREFIX_INVALID_MESSAGE } from '@neonflux/core/command-prefix';
import { authorizeCommandAction, DEFCON_FEATURE_CATEGORY } from '@neonflux/core/defcon';
import {
    findGuildCommandPermissionRule,
    findGuildSecurityPolicyByGuildId,
    upsertGuildCommandPrefix,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { sendBotFeatureReply } from './bot-feature-replies.js';
import type {
    BotFeatureHandlerContext,
    BotFeatureRouteError,
    BotFeatureRouteResult,
    BotMessageCreatedEvent,
} from './bot-feature-types.js';

const PREFIX_COMMAND_DENIED_REPLY =
    'You cannot change the prefix here. In lockdown, only the server owner can change guarded settings. Otherwise, this command requires Manage Server or an allowed role/user rule.';
const PREFIX_COMMAND_GUILD_ONLY_REPLY = 'I can only change the prefix inside a community.';
const PREFIX_COMMAND_INVALID_REPLY = COMMAND_PREFIX_INVALID_MESSAGE;
const PREFIX_COMMAND_USAGE_REPLY = 'Use: mention me with `prefix ?`.';
const PREFIX_COMMAND_ACTION = 'commands.prefix_change';

export type PrefixChangeCommandIntent = {
    type: 'prefix-change-command';
    rawPrefix: string | undefined;
};

export async function routePrefixChangeCommand(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent,
    rawPrefix: string | undefined
): Promise<Result<BotFeatureRouteResult, BotFeatureRouteError>> {
    if (!event.guildId) {
        return sendBotFeatureReply(context, event, PREFIX_COMMAND_GUILD_ONLY_REPLY, PREFIX_COMMAND_ACTION);
    }

    const authorizationResult = await authorizePrefixChange(context, event);

    if (authorizationResult.isErr()) {
        return err(authorizationResult.error);
    }

    if (!authorizationResult.value) {
        return sendBotFeatureReply(context, event, PREFIX_COMMAND_DENIED_REPLY, PREFIX_COMMAND_ACTION);
    }

    if (!rawPrefix) {
        return sendBotFeatureReply(
            context,
            event,
            `${PREFIX_COMMAND_USAGE_REPLY} ${PREFIX_COMMAND_INVALID_REPLY}`,
            PREFIX_COMMAND_ACTION
        );
    }

    const upsertResult = await upsertGuildCommandPrefix(context.db, {
        guildId: event.guildId,
        prefix: rawPrefix,
    });

    if (upsertResult.isErr()) {
        switch (upsertResult.error) {
            case 'invalid-prefix':
                return sendBotFeatureReply(context, event, PREFIX_COMMAND_INVALID_REPLY, PREFIX_COMMAND_ACTION);
            case 'missing-guild-id':
            case 'invalid-config':
            case 'not-found':
            case 'database-error':
                return err('database-error');
        }
    }

    return sendBotFeatureReply(
        context,
        event,
        `Command prefix updated to \`${upsertResult.value.prefix}\`.`,
        PREFIX_COMMAND_ACTION
    );
}

export function getMentionedPrefixCommand(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
): PrefixChangeCommandIntent | undefined {
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

export function getContentWithoutBotMention(content: string, botUserId: string): string {
    const escapedBotUserId = escapeRegExp(botUserId);

    return content.replace(new RegExp(`<@!?${escapedBotUserId}>`, 'g'), ' ').trim();
}

async function authorizePrefixChange(
    context: BotFeatureHandlerContext,
    event: BotMessageCreatedEvent
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
        category: DEFCON_FEATURE_CATEGORY.prefix,
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
        category: DEFCON_FEATURE_CATEGORY.prefix,
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

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
