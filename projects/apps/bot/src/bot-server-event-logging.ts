import { getServerLogEventGroupForEventType, type ServerLogEventGroup } from '@neonflux/core/server-event-logging';
import { findGuildLoggingDestinationByEventGroup } from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureEvent, BotFeatureHandlerContext } from './bot-feature-types.js';

export type BotServerEventLoggingResult =
    | { status: 'logged'; action: `event.logging.${ServerLogEventGroup}` }
    | { status: 'ignored'; reason: 'missing-guild-id' | 'no-feature-handler' };

type LoggableServerEvent = Exclude<BotFeatureEvent, { type: 'guild.lifecycle.created' | 'guild.lifecycle.deleted' }>;

const contentPreviewLimit = 600;

export async function logServerEvent(
    context: BotFeatureHandlerContext,
    event: LoggableServerEvent
): Promise<Result<BotServerEventLoggingResult, 'database-error' | 'message-send-error'>> {
    const eventGroup = getServerLogEventGroupForEventType(event.type);

    if (!eventGroup) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    if (!event.guildId) {
        return ok({ status: 'ignored', reason: 'missing-guild-id' });
    }

    const destinationResult = await findGuildLoggingDestinationByEventGroup(context.db, {
        guildId: event.guildId,
        eventGroup,
    });

    if (destinationResult.isErr()) {
        return destinationResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    if (!destinationResult.value.enabled) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const sendResult = await createFluxerPlatform(context.client).messages.send({
        channelId: destinationResult.value.channelId,
        content: formatServerEventLogMessage(event),
    });

    if (sendResult.isErr()) {
        return err('message-send-error');
    }

    return ok({
        status: 'logged',
        action: `event.logging.${eventGroup}`,
    });
}

function formatServerEventLogMessage(event: LoggableServerEvent): string {
    switch (event.type) {
        case 'message.updated':
            return compactLines([
                '**Message edited**',
                `Channel: ${channelRef(event.channelId)}`,
                `Author: ${userRef(event.authorId)}`,
                `Message ID: ${event.messageId}`,
                event.oldContent ? `Before:\n${quotePreview(event.oldContent)}` : 'Before: unavailable',
                event.content ? `After:\n${quotePreview(event.content)}` : 'After: empty',
            ]);

        case 'message.deleted':
            return compactLines([
                '**Message deleted**',
                `Channel: ${channelRef(event.channelId)}`,
                event.authorId ? `Author: ${userRef(event.authorId)}` : 'Author: unavailable',
                `Message ID: ${event.messageId}`,
                event.content ? `Content:\n${quotePreview(event.content)}` : 'Content: unavailable',
            ]);

        case 'member.joined':
            return compactLines(['**Member joined**', `User: ${userRef(event.userId)}`]);

        case 'member.updated':
            return compactLines([
                '**Member updated**',
                `User: ${userRef(event.userId)}`,
                `Roles: ${formatRoleList(event.roleIds)}`,
            ]);

        case 'member.left':
            return compactLines(['**Member left**', `User: ${userRef(event.userId)}`]);

        case 'ban.added':
            return compactLines(['**User banned**', `User: ${userRef(event.userId)}`]);

        case 'ban.removed':
            return compactLines(['**User unbanned**', `User: ${userRef(event.userId)}`]);

        case 'role.created':
            return compactLines(['**Role created**', `Role: ${roleRef(event.roleId)}`]);

        case 'role.updated':
            return compactLines(['**Role updated**', `Role: ${roleRef(event.roleId)}`]);

        case 'role.deleted':
            return compactLines(['**Role deleted**', `Role ID: ${event.roleId}`]);

        case 'channel.created':
            return compactLines(['**Channel created**', `Channel: ${channelRef(event.channelId)}`]);

        case 'channel.updated':
            return compactLines(['**Channel updated**', `Channel: ${channelRef(event.channelId)}`]);

        case 'channel.deleted':
            return compactLines(['**Channel deleted**', `Channel ID: ${event.channelId}`]);

        case 'voice_state.updated':
            return compactLines([
                '**Voice state updated**',
                event.userId ? `User: ${userRef(event.userId)}` : 'User: unavailable',
                event.channelId ? `Channel: ${channelRef(event.channelId)}` : 'Channel: none',
            ]);

        case 'guild.lifecycle.updated':
        case 'reaction.added':
        case 'reaction.removed':
        case 'message.created':
            return '**Server event**';
    }
}

function userRef(userId: string): string {
    return `<@${userId}> (${userId})`;
}

function channelRef(channelId: string): string {
    return `<#${channelId}> (${channelId})`;
}

function roleRef(roleId: string): string {
    return `<@&${roleId}> (${roleId})`;
}

function formatRoleList(roleIds: readonly string[]): string {
    return roleIds.length > 0 ? roleIds.map(roleRef).join(', ') : 'none';
}

function quotePreview(content: string): string {
    return truncateContent(neutralizeMassMentions(content))
        .split('\n')
        .map((line) => `> ${line || ' '}`)
        .join('\n');
}

function truncateContent(content: string): string {
    return content.length > contentPreviewLimit ? `${content.slice(0, contentPreviewLimit - 1)}...` : content;
}

function neutralizeMassMentions(content: string): string {
    const zeroWidthSpace = '\u200b';

    return content.replaceAll('@everyone', `@${zeroWidthSpace}everyone`).replaceAll('@here', `@${zeroWidthSpace}here`);
}

function compactLines(lines: readonly string[]): string {
    return lines.filter(Boolean).join('\n');
}
