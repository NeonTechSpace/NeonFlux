import {
    addTicketMember,
    createTicket,
    findEnabledTicketPanelByMessageId,
    findTicketByChannelId,
    listOpenTicketsByPanelAndOpener,
    recordTicketEvent,
    reserveNextTicketNumber,
    type TicketPanelRecord,
    type TicketRecord,
    updateTicketChannelId,
    updateTicketStatus,
} from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext, BotFeatureRouteHandledAction } from './bot-feature-types.js';

type BotTicketReactionEvent = {
    type: 'reaction.added' | 'reaction.removed';
    guildId: string | null;
    messageId: string;
    channelId: string;
    userId: string;
    emojiKey: string;
};

type BotTicketChannelDeletedEvent = {
    type: 'channel.deleted';
    guildId: string | null;
    channelId: string;
};

type BotTicketResult =
    | { status: 'applied'; action: BotFeatureRouteHandledAction }
    | { status: 'ignored'; reason: 'no-feature-handler' | 'guild-not-processable' };

type TicketPanelConfig = {
    description: string;
    openEmoji: string;
    openEmojiKey: string;
    ticketCategoryId: string;
    staffRoleIds: string[];
    ticketNameTemplate: string;
    maxOpenPerUser: number;
    privateTickets: boolean;
};

const defaultTicketPanelConfig: TicketPanelConfig = {
    description: 'React to open a ticket.',
    openEmoji: '🎫',
    openEmojiKey: 'unicode:🎫',
    ticketCategoryId: '',
    staffRoleIds: [],
    ticketNameTemplate: 'ticket-{number}',
    maxOpenPerUser: 1,
    privateTickets: true,
};
const viewChannelPermission = 1_024;
const sendMessagesPermission = 2_048;
const readMessageHistoryPermission = 65_536;
const ticketAllowPermissions = String(viewChannelPermission + sendMessagesPermission + readMessageHistoryPermission);
const ticketDenyPermissions = String(viewChannelPermission);

export async function routeTicketReactionEvent(
    context: BotFeatureHandlerContext,
    event: BotTicketReactionEvent
): Promise<Result<BotTicketResult, 'database-error' | 'platform-error'>> {
    if (!event.guildId) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    if (event.type !== 'reaction.added' || (context.botUserId && event.userId === context.botUserId)) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const panelResult = await findEnabledTicketPanelByMessageId(context.db, {
        guildId: event.guildId,
        messageId: event.messageId,
    });

    if (panelResult.isErr()) {
        return panelResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    const config = normalizeTicketPanelConfig(panelResult.value);

    if (!matchesOpenEmoji(event.emojiKey, config)) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const existingTicketsResult = await listOpenTicketsByPanelAndOpener(context.db, {
        panelId: panelResult.value.id,
        openerUserId: event.userId,
        limit: config.maxOpenPerUser,
    });

    if (existingTicketsResult.isErr()) {
        return err('database-error');
    }

    if (existingTicketsResult.value.length >= config.maxOpenPerUser) {
        return ok({ status: 'applied', action: 'event.tickets.open_existing' });
    }

    return openTicketFromPanel(context, {
        guildId: event.guildId,
        openerUserId: event.userId,
        panel: panelResult.value,
        config,
    });
}

export async function routeTicketChannelDeletedEvent(
    context: BotFeatureHandlerContext,
    event: BotTicketChannelDeletedEvent
): Promise<Result<BotTicketResult, 'database-error' | 'platform-error'>> {
    if (!event.guildId) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    const ticketResult = await findTicketByChannelId(context.db, {
        guildId: event.guildId,
        channelId: event.channelId,
    });

    if (ticketResult.isErr()) {
        return ticketResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    if (ticketResult.value.status === 'archived') {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const statusResult = await updateTicketStatus(context.db, {
        ticketId: ticketResult.value.id,
        status: 'closed',
    });

    if (statusResult.isErr()) {
        return err('database-error');
    }

    const eventResult = await recordTicketEvent(context.db, {
        ticketId: ticketResult.value.id,
        eventType: 'channel.deleted',
        details: {
            channelId: event.channelId,
        },
    });

    if (eventResult.isErr()) {
        return err('database-error');
    }

    return ok({ status: 'applied', action: 'event.tickets.channel_deleted' });
}

async function openTicketFromPanel(
    context: BotFeatureHandlerContext,
    input: {
        guildId: string;
        openerUserId: string;
        panel: TicketPanelRecord;
        config: TicketPanelConfig;
    }
): Promise<Result<BotTicketResult, 'database-error' | 'platform-error'>> {
    const ticketNumberResult = await reserveNextTicketNumber(context.db, { guildId: input.guildId });

    if (ticketNumberResult.isErr()) {
        return err('database-error');
    }

    const ticketResult = await createTicket(context.db, {
        guildId: input.guildId,
        ticketNumber: ticketNumberResult.value,
        openerUserId: input.openerUserId,
        panelId: input.panel.id,
    });

    if (ticketResult.isErr()) {
        return err('database-error');
    }

    const memberResult = await addTicketMember(context.db, {
        ticketId: ticketResult.value.id,
        userId: input.openerUserId,
        role: 'opener',
    });

    if (memberResult.isErr()) {
        return err('database-error');
    }

    const platform = createFluxerPlatform(context.client);
    const channelResult = await platform.channels.create({
        guildId: input.guildId,
        type: 0,
        name: formatTicketChannelName(input.config.ticketNameTemplate, {
            ticketNumber: ticketNumberResult.value,
            openerUserId: input.openerUserId,
        }),
        parentId: input.config.ticketCategoryId || null,
    });

    if (channelResult.isErr()) {
        await markTicketOpenFailed(context, ticketResult.value, 'channel-create-failed');
        return err('platform-error');
    }

    const channelUpdateResult = await updateTicketChannelId(context.db, {
        ticketId: ticketResult.value.id,
        channelId: channelResult.value.id,
    });

    if (channelUpdateResult.isErr()) {
        return err('database-error');
    }

    if (input.config.privateTickets) {
        const permissionsResult = await applyTicketPermissions(context, {
            guildId: input.guildId,
            channelId: channelResult.value.id,
            openerUserId: input.openerUserId,
            staffRoleIds: input.config.staffRoleIds,
        });

        if (permissionsResult.isErr()) {
            await recordTicketEvent(context.db, {
                ticketId: ticketResult.value.id,
                eventType: 'permissions.failed',
                details: { channelId: channelResult.value.id },
            });
            return err('platform-error');
        }
    }

    const introResult = await platform.messages.send({
        channelId: channelResult.value.id,
        content: `<@${input.openerUserId}> Ticket #${String(ticketNumberResult.value)} opened.`,
    });

    if (introResult.isErr()) {
        await recordTicketEvent(context.db, {
            ticketId: ticketResult.value.id,
            eventType: 'intro.failed',
            details: { channelId: channelResult.value.id },
        });
        return err('platform-error');
    }

    const openedEventResult = await recordTicketEvent(context.db, {
        ticketId: ticketResult.value.id,
        eventType: 'opened',
        actorUserId: input.openerUserId,
        details: {
            channelId: channelResult.value.id,
            panelId: input.panel.id,
        },
    });

    if (openedEventResult.isErr()) {
        return err('database-error');
    }

    return ok({ status: 'applied', action: 'event.tickets.opened' });
}

async function applyTicketPermissions(
    context: BotFeatureHandlerContext,
    input: { guildId: string; channelId: string; openerUserId: string; staffRoleIds: readonly string[] }
): Promise<Result<void, 'platform-error'>> {
    const platform = createFluxerPlatform(context.client);
    const overwriteResults = [
        await platform.channels.editPermission({
            channelId: input.channelId,
            overwriteId: input.guildId,
            type: 0,
            deny: ticketDenyPermissions,
        }),
        await platform.channels.editPermission({
            channelId: input.channelId,
            overwriteId: input.openerUserId,
            type: 1,
            allow: ticketAllowPermissions,
        }),
    ];

    for (const roleId of input.staffRoleIds) {
        overwriteResults.push(
            await platform.channels.editPermission({
                channelId: input.channelId,
                overwriteId: roleId,
                type: 0,
                allow: ticketAllowPermissions,
            })
        );
    }

    return overwriteResults.some((result) => result.isErr()) ? err('platform-error') : ok(undefined);
}

async function markTicketOpenFailed(
    context: BotFeatureHandlerContext,
    ticket: TicketRecord,
    reason: string
): Promise<void> {
    await updateTicketStatus(context.db, {
        ticketId: ticket.id,
        status: 'archived',
    }).catch(() => undefined);
    await recordTicketEvent(context.db, {
        ticketId: ticket.id,
        eventType: 'open.failed',
        details: { reason },
    }).catch(() => undefined);
}

function normalizeTicketPanelConfig(panel: TicketPanelRecord): TicketPanelConfig {
    const config = panel.config;
    const openEmoji = readString(config.openEmoji, defaultTicketPanelConfig.openEmoji);

    return {
        description: readString(config.description, defaultTicketPanelConfig.description),
        openEmoji,
        openEmojiKey: readString(config.openEmojiKey, `unicode:${openEmoji}`),
        ticketCategoryId: readString(config.ticketCategoryId, ''),
        staffRoleIds: Array.isArray(config.staffRoleIds)
            ? config.staffRoleIds.filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0)
            : [],
        ticketNameTemplate: readString(config.ticketNameTemplate, defaultTicketPanelConfig.ticketNameTemplate),
        maxOpenPerUser:
            typeof config.maxOpenPerUser === 'number' && Number.isInteger(config.maxOpenPerUser)
                ? Math.min(Math.max(config.maxOpenPerUser, 1), 10)
                : defaultTicketPanelConfig.maxOpenPerUser,
        privateTickets: typeof config.privateTickets === 'boolean' ? config.privateTickets : true,
    };
}

function matchesOpenEmoji(emojiKey: string, config: TicketPanelConfig): boolean {
    return (
        emojiKey === config.openEmoji || emojiKey === config.openEmojiKey || emojiKey === `unicode:${config.openEmoji}`
    );
}

function formatTicketChannelName(template: string, input: { ticketNumber: number; openerUserId: string }): string {
    const rawName = template
        .replaceAll('{number}', String(input.ticketNumber))
        .replaceAll('{user}', input.openerUserId);
    const normalizedName = rawName
        .toLowerCase()
        .replace(/[^a-z0-9-_ ]/gu, '')
        .trim()
        .replace(/\s+/gu, '-')
        .slice(0, 90);

    return normalizedName || `ticket-${String(input.ticketNumber)}`;
}

function readString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
