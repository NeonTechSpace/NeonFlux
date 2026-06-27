import {
    drawGiveawayWinners,
    findActiveGiveawayByGuildMessageId,
    listExpiredActiveGiveaways,
    listReactionReconciliationGiveaways,
    listStaleActiveGiveaways,
    reconcileGiveawayEntries,
    removeGiveawayEntry,
    updateGiveawaySyncStatus,
    upsertGiveawayEntry,
    type GiveawayRecord,
    type GiveawayWinnerRecord,
} from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext, BotFeatureRouteHandledAction } from './bot-feature-types.js';

type BotGiveawayReactionEvent = {
    type: 'reaction.added' | 'reaction.removed';
    guildId: string | null;
    messageId: string;
    userId: string;
    emojiKey: string;
};

type BotGiveawayResult =
    | { status: 'applied'; action: BotFeatureRouteHandledAction }
    | { status: 'ignored'; reason: 'no-feature-handler' | 'guild-not-processable' };

export type GiveawayMaintenanceSummary = {
    expiredChecked: number;
    closed: number;
    closeSkipped: number;
    closeAnnouncementFailed: number;
    staleChecked: number;
    repaired: number;
    repairFailed: number;
    reactionChecked: number;
    reactionReconciled: number;
    reactionReconcileFailed: number;
    reactionEntriesAdded: number;
    reactionEntriesRemoved: number;
};

const giveawayMaintenanceBatchSize = 25;
const giveawayReactionUserPageSize = 100;
const giveawayReactionUserMaxPages = 10;

export async function routeGiveawayReactionEvent(
    context: BotFeatureHandlerContext,
    event: BotGiveawayReactionEvent
): Promise<Result<BotGiveawayResult, 'database-error'>> {
    if (!event.guildId) {
        return ok({ status: 'ignored', reason: 'guild-not-processable' });
    }

    if (context.botUserId && event.userId === context.botUserId) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const giveawayResult = await findActiveGiveawayByGuildMessageId(context.db, {
        guildId: event.guildId,
        messageId: event.messageId,
    });

    if (giveawayResult.isErr()) {
        return giveawayResult.error.type === 'not-found'
            ? ok({ status: 'ignored', reason: 'no-feature-handler' })
            : err('database-error');
    }

    if (!matchesGiveawayEntryEmoji(event.emojiKey, giveawayResult.value)) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    if (event.type === 'reaction.removed') {
        const removeResult = await removeGiveawayEntry(context.db, {
            giveawayId: giveawayResult.value.id,
            userId: event.userId,
        });

        if (removeResult.isErr() && removeResult.error.type !== 'not-found') {
            return err('database-error');
        }

        return ok({ status: 'applied', action: 'event.giveaways.entry_removed' });
    }

    const entryResult = await upsertGiveawayEntry(context.db, {
        giveawayId: giveawayResult.value.id,
        userId: event.userId,
    });

    if (entryResult.isErr()) {
        return err('database-error');
    }

    return ok({ status: 'applied', action: 'event.giveaways.entry_added' });
}

export async function runGiveawayMaintenance(
    context: BotFeatureHandlerContext,
    input: { now?: Date; limit?: number } = {}
): Promise<Result<GiveawayMaintenanceSummary, 'database-error'>> {
    const limit = input.limit ?? giveawayMaintenanceBatchSize;
    const closeResult = await closeExpiredGiveaways(context, {
        now: input.now ?? new Date(),
        limit,
    });

    if (closeResult.isErr()) return err(closeResult.error);

    const repairResult = await repairStaleGiveawayReactions(context, { limit });

    if (repairResult.isErr()) return err(repairResult.error);

    const reconcileResult = await reconcileGiveawayReactionEntries(context, { limit });

    if (reconcileResult.isErr()) return err(reconcileResult.error);

    return ok({
        ...closeResult.value,
        ...repairResult.value,
        ...reconcileResult.value,
    });
}

export async function closeExpiredGiveaways(
    context: BotFeatureHandlerContext,
    input: { now: Date; limit?: number }
): Promise<
    Result<
        Pick<GiveawayMaintenanceSummary, 'expiredChecked' | 'closed' | 'closeSkipped' | 'closeAnnouncementFailed'>,
        'database-error'
    >
> {
    const expiredResult = await listExpiredActiveGiveaways(context.db, {
        now: input.now,
        limit: input.limit ?? giveawayMaintenanceBatchSize,
    });

    if (expiredResult.isErr()) return err('database-error');

    const platform = createFluxerPlatform(context.client);
    let closed = 0;
    let closeSkipped = 0;
    let closeAnnouncementFailed = 0;

    for (const giveaway of expiredResult.value) {
        const drawResult = await drawGiveawayWinners(context.db, {
            guildId: giveaway.guildId,
            giveawayId: giveaway.id,
        });

        if (drawResult.isErr()) {
            if (drawResult.error.type === 'database-error') return err('database-error');

            closeSkipped += 1;
            continue;
        }

        closed += 1;

        const announcement = await platform.messages.send({
            channelId: drawResult.value.giveaway.channelId,
            content: formatGiveawayCloseAnnouncement(drawResult.value.giveaway, drawResult.value.winners),
        });

        if (announcement.isErr()) {
            closeAnnouncementFailed += 1;
        }
    }

    return ok({
        expiredChecked: expiredResult.value.length,
        closed,
        closeSkipped,
        closeAnnouncementFailed,
    });
}

export async function repairStaleGiveawayReactions(
    context: BotFeatureHandlerContext,
    input: { limit?: number } = {}
): Promise<Result<Pick<GiveawayMaintenanceSummary, 'staleChecked' | 'repaired' | 'repairFailed'>, 'database-error'>> {
    const staleResult = await listStaleActiveGiveaways(context.db, {
        limit: input.limit ?? giveawayMaintenanceBatchSize,
    });

    if (staleResult.isErr()) return err('database-error');

    const platform = createFluxerPlatform(context.client);
    let repaired = 0;
    let repairFailed = 0;

    for (const giveaway of staleResult.value) {
        if (!giveaway.messageId) {
            repairFailed += 1;
            continue;
        }

        const reactionResult = await platform.messages.react({
            channelId: giveaway.channelId,
            messageId: giveaway.messageId,
            emoji: giveaway.entryEmoji,
        });

        if (reactionResult.isErr()) {
            repairFailed += 1;
            continue;
        }

        const updateResult = await updateGiveawaySyncStatus(context.db, {
            guildId: giveaway.guildId,
            giveawayId: giveaway.id,
            syncStatus: 'active',
        });

        if (updateResult.isErr()) return err('database-error');

        repaired += 1;
    }

    return ok({
        staleChecked: staleResult.value.length,
        repaired,
        repairFailed,
    });
}

export async function reconcileGiveawayReactionEntries(
    context: BotFeatureHandlerContext,
    input: { limit?: number } = {}
): Promise<
    Result<
        Pick<
            GiveawayMaintenanceSummary,
            | 'reactionChecked'
            | 'reactionReconciled'
            | 'reactionReconcileFailed'
            | 'reactionEntriesAdded'
            | 'reactionEntriesRemoved'
        >,
        'database-error'
    >
> {
    const giveawaysResult = await listReactionReconciliationGiveaways(context.db, {
        limit: input.limit ?? giveawayMaintenanceBatchSize,
    });

    if (giveawaysResult.isErr()) return err('database-error');

    const platform = createFluxerPlatform(context.client);
    let reactionReconciled = 0;
    let reactionReconcileFailed = 0;
    let reactionEntriesAdded = 0;
    let reactionEntriesRemoved = 0;

    for (const giveaway of giveawaysResult.value) {
        if (!giveaway.messageId) {
            reactionReconcileFailed += 1;
            continue;
        }

        const userIdsResult = await readGiveawayReactionUserIds(context, platform, giveaway);

        if (!userIdsResult) {
            reactionReconcileFailed += 1;
            continue;
        }

        const reconcileResult = await reconcileGiveawayEntries(context.db, {
            giveawayId: giveaway.id,
            userIds: userIdsResult,
        });

        if (reconcileResult.isErr()) return err('database-error');

        reactionReconciled += 1;
        reactionEntriesAdded += reconcileResult.value.added;
        reactionEntriesRemoved += reconcileResult.value.removed;
    }

    return ok({
        reactionChecked: giveawaysResult.value.length,
        reactionReconciled,
        reactionReconcileFailed,
        reactionEntriesAdded,
        reactionEntriesRemoved,
    });
}

async function readGiveawayReactionUserIds(
    context: BotFeatureHandlerContext,
    platform: ReturnType<typeof createFluxerPlatform>,
    giveaway: GiveawayRecord
): Promise<string[] | undefined> {
    const userIds: string[] = [];
    let after: string | undefined;

    for (let page = 0; page < giveawayReactionUserMaxPages; page += 1) {
        const usersResult = await platform.messages.listReactionUsers({
            channelId: giveaway.channelId,
            messageId: giveaway.messageId ?? '',
            emoji: giveaway.entryEmoji,
            limit: giveawayReactionUserPageSize,
            ...(after ? { after } : {}),
        });

        if (usersResult.isErr()) return undefined;

        const users = usersResult.value.filter((user) => !user.bot && user.id !== context.botUserId);
        userIds.push(...users.map((user) => user.id));

        if (usersResult.value.length < giveawayReactionUserPageSize) break;

        after = usersResult.value.at(-1)?.id;

        if (!after) break;
    }

    return [...new Set(userIds)];
}

function matchesGiveawayEntryEmoji(emojiKey: string, giveaway: GiveawayRecord): boolean {
    return emojiKey === giveaway.entryEmoji || emojiKey === `unicode:${giveaway.entryEmoji}`;
}

function formatGiveawayCloseAnnouncement(giveaway: GiveawayRecord, winners: readonly GiveawayWinnerRecord[]): string {
    const winnerText = winners.length > 0 ? winners.map((winner) => `<@${winner.userId}>`).join(', ') : 'No winners.';

    return `Giveaway closed: ${giveaway.title}\nWinners: ${winnerText}`;
}
