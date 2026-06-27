import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    createGiveaway,
    drawGiveawayWinners,
    listActiveGiveawayEntries,
    listGiveawayWinners,
    listGiveawaysByGuildId,
    recordBotActionEvent,
    recordGiveawayEvent,
    updateGiveawayStatus,
} from '@neonflux/db';
import type { GiveawayRecord, GiveawayWinnerRecord } from '@neonflux/db';
import { reactFluxerBotGuildChannelMessage, sendFluxerBotGuildChannelMessage } from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import type { DashboardGiveawayChannel } from './dashboard-giveaways-structure.server.js';
import { loadGiveawaysStructure } from './dashboard-giveaways-structure.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardGiveaway = {
    id: string;
    channelId: string;
    channelName?: string;
    messageId?: string;
    title: string;
    prize: string;
    description?: string;
    entryEmoji: string;
    winnerCount: number;
    status: string;
    entryCount: number;
    winners: DashboardGiveawayWinner[];
    syncStatus: 'active' | 'stale';
    endsAt?: string;
    closedAt?: string;
    createdAt: string;
};

export type DashboardGiveawayWinner = {
    userId: string;
    drawNumber: number;
    selectedAt: string;
};

export type DashboardGiveawaysSettingsResult =
    | {
          type: 'settings';
          structureReadStatus: 'available' | 'bot-token-missing' | 'fetch-failed';
          channels: DashboardGiveawayChannel[];
          giveaways: DashboardGiveaway[];
      }
    | DashboardGiveawaysErrorResult;

export type DashboardGiveawayPublishInput = {
    guildId: string;
    channelId: string;
    title: string;
    prize: string;
    description?: string;
    entryEmoji?: string;
    winnerCount?: number;
    endsAt?: string;
};

export type DashboardGiveawayActionInput = {
    guildId: string;
    giveawayId: string;
};

export type DashboardGiveawayMutationResult =
    | { type: 'updated'; giveaway: DashboardGiveaway; announcementStatus: 'sent' | 'failed' | 'not-needed' }
    | { type: 'invalid-input'; field: string }
    | { type: 'bot-token-missing' }
    | { type: 'message-send-error' }
    | DashboardGiveawaysErrorResult;

type DashboardGiveawaysErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;
type GiveawaysActor =
    | { type: 'actor'; actorUserId: string; metadata: Record<string, string> }
    | { type: 'auth-required' }
    | { type: 'database-error' };

const dashboardGiveawaysFeature = 'giveaways';

export async function loadDashboardGiveawaysSettings(
    request: Request,
    guildId: string
): Promise<DashboardGiveawaysSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const database = getWebDatabaseClient();
    const giveawaysResult = await listGiveawaysByGuildId(database.db, {
        guildId: guildPageData.guild.id,
        limit: 50,
    });

    if (giveawaysResult.isErr()) {
        return { type: 'database-error' };
    }

    const structureResult = await loadGiveawaysStructure(guildPageData.guild.id);
    const giveaways = await Promise.all(
        giveawaysResult.value.map((giveaway) =>
            toDashboardGiveaway(database.db, giveaway, {
                channelsById: structureResult.channelsById,
            })
        )
    );

    if (giveaways.some((giveaway) => giveaway === undefined)) {
        return { type: 'database-error' };
    }

    return {
        type: 'settings',
        structureReadStatus: structureResult.status,
        channels: structureResult.channels,
        giveaways: giveaways as DashboardGiveaway[],
    };
}

export async function publishDashboardGiveaway(
    request: Request,
    input: DashboardGiveawayPublishInput
): Promise<DashboardGiveawayMutationResult> {
    const context = await loadAuthorizedMutationContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const payload = normalizeGiveawayPublishInput(input);

    if (payload.type === 'invalid-input') return payload;

    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) return { type: 'bot-token-missing' };

    const sendResult = await sendFluxerBotGuildChannelMessage({
        botToken,
        guildId: context.guild.id,
        channelId: payload.channelId,
        embeds: [toGiveawayEmbed(payload)],
    });

    if (sendResult.isErr()) return { type: 'message-send-error' };

    const reactionResult = await reactFluxerBotGuildChannelMessage({
        botToken,
        guildId: context.guild.id,
        channelId: payload.channelId,
        messageId: sendResult.value.id,
        emoji: payload.entryEmoji,
    });
    const database = getWebDatabaseClient();
    const giveawayResult = await createGiveaway(database.db, {
        guildId: context.guild.id,
        channelId: payload.channelId,
        messageId: sendResult.value.id,
        title: payload.title,
        prize: payload.prize,
        description: payload.description,
        entryEmoji: payload.entryEmoji,
        winnerCount: payload.winnerCount,
        status: 'active',
        endsAt: payload.endsAt,
        createdByUserId: context.actor.actorUserId,
        config: {
            syncStatus: reactionResult.isOk() ? 'active' : 'stale',
        },
    });

    if (giveawayResult.isErr()) return mapRepositoryError(giveawayResult.error);

    const eventResult = await recordGiveawayEvent(database.db, {
        giveawayId: giveawayResult.value.id,
        eventType: 'published',
        actorUserId: context.actor.actorUserId,
        details: { messageId: sendResult.value.id },
    });

    if (eventResult.isErr()) return { type: 'database-error' };

    const auditResult = await recordGiveawayAudit(context, giveawayResult.value, 'giveaway.published', {
        messageId: sendResult.value.id,
        syncStatus: reactionResult.isOk() ? 'active' : 'stale',
    });

    if (auditResult === 'database-error') return { type: 'database-error' };

    const giveaway = await toDashboardGiveaway(database.db, giveawayResult.value, { channelsById: new Map() });

    return giveaway
        ? {
              type: 'updated',
              giveaway,
              announcementStatus: reactionResult.isOk() ? 'sent' : 'failed',
          }
        : { type: 'database-error' };
}

export async function closeDashboardGiveaway(
    request: Request,
    input: DashboardGiveawayActionInput
): Promise<DashboardGiveawayMutationResult> {
    return drawDashboardGiveaway(request, input, false);
}

export async function rerollDashboardGiveaway(
    request: Request,
    input: DashboardGiveawayActionInput
): Promise<DashboardGiveawayMutationResult> {
    return drawDashboardGiveaway(request, input, true);
}

export async function cancelDashboardGiveaway(
    request: Request,
    input: DashboardGiveawayActionInput
): Promise<DashboardGiveawayMutationResult> {
    const context = await loadAuthorizedMutationContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) return { type: 'bot-token-missing' };

    const database = getWebDatabaseClient();
    const giveawayResult = await updateGiveawayStatus(database.db, {
        guildId: context.guild.id,
        giveawayId: input.giveawayId,
        status: 'cancelled',
        actorUserId: context.actor.actorUserId,
    });

    if (giveawayResult.isErr()) return mapRepositoryError(giveawayResult.error);

    const eventResult = await recordGiveawayEvent(database.db, {
        giveawayId: giveawayResult.value.id,
        eventType: 'cancelled',
        actorUserId: context.actor.actorUserId,
    });

    if (eventResult.isErr()) return { type: 'database-error' };

    const announcementStatus = await announceGiveaway(
        botToken,
        context.guild.id,
        giveawayResult.value,
        'cancelled',
        []
    );
    const auditResult = await recordGiveawayAudit(context, giveawayResult.value, 'giveaway.cancelled', {});

    if (auditResult === 'database-error') return { type: 'database-error' };

    const giveaway = await toDashboardGiveaway(database.db, giveawayResult.value, { channelsById: new Map() });

    return giveaway ? { type: 'updated', giveaway, announcementStatus } : { type: 'database-error' };
}

async function drawDashboardGiveaway(
    request: Request,
    input: DashboardGiveawayActionInput,
    reroll: boolean
): Promise<DashboardGiveawayMutationResult> {
    const context = await loadAuthorizedMutationContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) return { type: 'bot-token-missing' };

    const database = getWebDatabaseClient();
    const drawResult = await drawGiveawayWinners(database.db, {
        guildId: context.guild.id,
        giveawayId: input.giveawayId,
        actorUserId: context.actor.actorUserId,
        reroll,
    });

    if (drawResult.isErr()) return mapRepositoryError(drawResult.error);

    const announcementStatus = await announceGiveaway(
        botToken,
        context.guild.id,
        drawResult.value.giveaway,
        reroll ? 'rerolled' : 'closed',
        drawResult.value.winners
    );
    const auditResult = await recordGiveawayAudit(
        context,
        drawResult.value.giveaway,
        reroll ? 'giveaway.rerolled' : 'giveaway.closed',
        { winnerCount: drawResult.value.winners.length }
    );

    if (auditResult === 'database-error') return { type: 'database-error' };

    const giveaway = await toDashboardGiveaway(database.db, drawResult.value.giveaway, { channelsById: new Map() });

    return giveaway ? { type: 'updated', giveaway, announcementStatus } : { type: 'database-error' };
}

async function loadAuthorizedMutationContext(request: Request, guildId: string) {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') return mapDashboardGuildPageError(guildPageData);

    const actor = await resolveGiveawaysActor(request);

    if (actor.type !== 'actor') return actor;

    return {
        type: 'authorized' as const,
        guild: guildPageData.guild,
        actor,
    };
}

async function toDashboardGiveaway(
    db: Parameters<typeof listActiveGiveawayEntries>[0],
    record: GiveawayRecord,
    lookups: { channelsById: ReadonlyMap<string, DashboardGiveawayChannel> }
): Promise<DashboardGiveaway | undefined> {
    const entriesResult = await listActiveGiveawayEntries(db, { giveawayId: record.id });
    const winnersResult = await listGiveawayWinners(db, { giveawayId: record.id });

    if (entriesResult.isErr() || winnersResult.isErr()) return undefined;

    const channel = lookups.channelsById.get(record.channelId);

    return {
        id: record.id,
        channelId: record.channelId,
        ...(channel ? { channelName: channel.name } : {}),
        ...(record.messageId ? { messageId: record.messageId } : {}),
        title: record.title,
        prize: record.prize,
        ...(record.description ? { description: record.description } : {}),
        entryEmoji: record.entryEmoji,
        winnerCount: record.winnerCount,
        status: record.status,
        entryCount: entriesResult.value.length,
        winners: winnersResult.value.map(toDashboardWinner),
        syncStatus: record.config.syncStatus === 'stale' ? 'stale' : 'active',
        ...(record.endsAt ? { endsAt: record.endsAt.toISOString() } : {}),
        ...(record.closedAt ? { closedAt: record.closedAt.toISOString() } : {}),
        createdAt: record.createdAt.toISOString(),
    };
}

function normalizeGiveawayPublishInput(input: DashboardGiveawayPublishInput):
    | {
          type: 'valid';
          channelId: string;
          title: string;
          prize: string;
          description?: string;
          entryEmoji: string;
          winnerCount: number;
          endsAt?: Date;
      }
    | { type: 'invalid-input'; field: string } {
    const channelId = input.channelId.trim();
    const title = input.title.trim();
    const prize = input.prize.trim();
    const entryEmoji = input.entryEmoji?.trim() || '🎉';
    const winnerCount = input.winnerCount ?? 1;
    const endsAt = input.endsAt?.trim() ? new Date(input.endsAt) : undefined;

    if (!channelId) return { type: 'invalid-input', field: 'channelId' };
    if (!title) return { type: 'invalid-input', field: 'title' };
    if (!prize) return { type: 'invalid-input', field: 'prize' };
    if (!entryEmoji) return { type: 'invalid-input', field: 'entryEmoji' };
    if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 25) {
        return { type: 'invalid-input', field: 'winnerCount' };
    }
    if (endsAt && Number.isNaN(endsAt.getTime())) return { type: 'invalid-input', field: 'endsAt' };

    return {
        type: 'valid',
        channelId,
        title,
        prize,
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        entryEmoji,
        winnerCount,
        ...(endsAt ? { endsAt } : {}),
    };
}

function toGiveawayEmbed(input: Extract<ReturnType<typeof normalizeGiveawayPublishInput>, { type: 'valid' }>) {
    return {
        title: input.title,
        description: [
            `Prize: ${input.prize}`,
            input.description,
            `React with ${input.entryEmoji} to enter.`,
            input.endsAt ? `Ends: ${input.endsAt.toISOString()}` : undefined,
        ]
            .filter(Boolean)
            .join('\n\n'),
        color: 0x12d8c4,
        footer: { text: `${input.winnerCount} winner${input.winnerCount === 1 ? '' : 's'}` },
    };
}

async function announceGiveaway(
    botToken: string,
    guildId: string,
    giveaway: GiveawayRecord,
    action: 'closed' | 'rerolled' | 'cancelled',
    winners: readonly GiveawayWinnerRecord[]
): Promise<'sent' | 'failed' | 'not-needed'> {
    const winnerText = winners.length > 0 ? winners.map((winner) => `<@${winner.userId}>`).join(', ') : 'No winners.';
    const content =
        action === 'cancelled'
            ? `Giveaway cancelled: ${giveaway.title}`
            : `Giveaway ${action}: ${giveaway.title}\nWinners: ${winnerText}`;
    const sendResult = await sendFluxerBotGuildChannelMessage({
        botToken,
        guildId,
        channelId: giveaway.channelId,
        content,
    });

    return sendResult.isOk() ? 'sent' : 'failed';
}

async function resolveGiveawaysActor(request: Request): Promise<GiveawaysActor> {
    const authContextResult = await readAuthenticatedFluxerContext(request);

    if (authContextResult.isErr()) {
        return authContextResult.error === 'database-error' ? { type: 'database-error' } : { type: 'auth-required' };
    }

    const currentUserResult = await getFluxerCurrentUser({ accessToken: authContextResult.value.accessToken });

    if (currentUserResult.isErr() || currentUserResult.value.id !== authContextResult.value.fluxerUserId) {
        return { type: 'actor', actorUserId: authContextResult.value.fluxerUserId, metadata: {} };
    }

    return {
        type: 'actor',
        actorUserId: authContextResult.value.fluxerUserId,
        metadata: {
            actorUsername: currentUserResult.value.username,
            ...(currentUserResult.value.globalName ? { actorDisplayName: currentUserResult.value.globalName } : {}),
        },
    };
}

async function recordGiveawayAudit(
    context: Extract<Awaited<ReturnType<typeof loadAuthorizedMutationContext>>, { type: 'authorized' }>,
    giveaway: GiveawayRecord,
    action: string,
    metadata: Record<string, unknown>
): Promise<'recorded' | 'database-error'> {
    const result = await recordBotActionEvent(getWebDatabaseClient().db, {
        guildId: context.guild.id,
        feature: dashboardGiveawaysFeature,
        action,
        actorUserId: context.actor.actorUserId,
        targetId: giveaway.id,
        metadata: {
            giveawayId: giveaway.id,
            channelId: giveaway.channelId,
            messageId: giveaway.messageId,
            source: 'dashboard',
            ...metadata,
            ...context.actor.metadata,
        },
    });

    return result.isOk() ? 'recorded' : 'database-error';
}

function toDashboardWinner(record: GiveawayWinnerRecord): DashboardGiveawayWinner {
    return {
        userId: record.userId,
        drawNumber: record.drawNumber,
        selectedAt: record.selectedAt.toISOString(),
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardGiveawaysErrorResult {
    switch (guildPageData.type) {
        case 'auth-required':
        case 'deployment-config-not-found':
        case 'database-error':
        case 'guild-lookup-failed':
            return { type: guildPageData.type };
        case 'not-found':
        case 'single-unauthorized':
            return { type: 'not-found' };
    }
}

function mapRepositoryError(error: { type: string; field?: string }) {
    switch (error.type) {
        case 'missing-input':
        case 'invalid-value':
            return { type: 'invalid-input' as const, field: error.field ?? 'unknown' };
        case 'not-found':
            return { type: 'not-found' as const };
        case 'database-error':
        default:
            return { type: 'database-error' as const };
    }
}
