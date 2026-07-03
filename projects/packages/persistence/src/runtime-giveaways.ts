import { api } from '@neonflux/convex/api';
import {
    createGiveaway as createGiveawayPostgres,
    drawGiveawayWinners as drawGiveawayWinnersPostgres,
    findActiveGiveawayByGuildMessageId as findActiveGiveawayByGuildMessageIdPostgres,
    listActiveGiveawayEntries as listActiveGiveawayEntriesPostgres,
    listGiveawaysByGuildId as listGiveawaysByGuildIdPostgres,
    listGiveawayWinners as listGiveawayWinnersPostgres,
    recordGiveawayEvent as recordGiveawayEventPostgres,
    removeGiveawayEntry as removeGiveawayEntryPostgres,
    updateGiveawayStatus as updateGiveawayStatusPostgres,
    upsertGiveawayEntry as upsertGiveawayEntryPostgres,
    type GiveawayEntryRecord,
    type GiveawayEventRecord,
    type GiveawayRecord,
    type GiveawaysRepositoryError,
    type GiveawayWinnerRecord,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { isConvexPersistenceDatabase, type ConvexPersistenceDatabase } from './convex.js';
import {
    mapGiveawayConvexError,
    normalizeCreateLimit,
    normalizeGiveawayStatus,
    normalizeOptionalText,
    normalizePositiveInteger,
    normalizeRequiredText,
    toGiveawayEntryRecord,
    toGiveawayEventRecord,
    toGiveawayRecord,
    toGiveawayWinnerRecord,
    type ConvexGiveawayEntryRecord,
    type ConvexGiveawayEventRecord,
    type ConvexGiveawayRecord,
    type ConvexGiveawayWinnerRecord,
} from './runtime-giveaways-records.js';

type ConvexQueryReference = Parameters<ConvexPersistenceDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexPersistenceDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    giveaways: {
        createGiveaway: ConvexMutationReference;
        drawGiveawayWinners: ConvexMutationReference;
        findActiveGiveawayByGuildMessageId: ConvexQueryReference;
        findGiveawayById: ConvexQueryReference;
        listActiveGiveawayEntries: ConvexQueryReference;
        listGiveawayWinners: ConvexQueryReference;
        listGiveawaysByGuildId: ConvexQueryReference;
        recordGiveawayEvent: ConvexMutationReference;
        removeGiveawayEntry: ConvexMutationReference;
        updateGiveawayStatus: ConvexMutationReference;
        upsertGiveawayEntry: ConvexMutationReference;
    };
};

type PostgresGiveawaysDb = Parameters<typeof createGiveawayPostgres>[0];
export type GiveawaysDb = ConvexPersistenceDatabase | PostgresGiveawaysDb;

const giveawayStatusTransitions = new Map<string, readonly string[]>([
    ['draft', ['active', 'cancelled']],
    ['active', ['closed', 'cancelled']],
    ['closed', []],
    ['cancelled', []],
]);

export async function createGiveaway(
    db: GiveawaysDb,
    input: {
        channelId: string;
        config?: Record<string, unknown>;
        createdByUserId?: string;
        description?: string;
        endsAt?: Date | null;
        entryEmoji?: string;
        guildId: string;
        messageId?: string;
        prize: string;
        status?: string;
        title: string;
        winnerCount?: number;
    }
): Promise<Result<GiveawayRecord, GiveawaysRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return createGiveawayPostgres(db, input);

    const normalizedInput = normalizeGiveawayInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const giveaway = (await db.client.mutation(
            convexApi.giveaways.createGiveaway,
            normalizedInput.value
        )) as ConvexGiveawayRecord;

        return ok(toGiveawayRecord(giveaway));
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}

export async function listGiveawaysByGuildId(
    db: GiveawaysDb,
    input: { guildId: string; limit?: number }
): Promise<Result<GiveawayRecord[], GiveawaysRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listGiveawaysByGuildIdPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const giveaways = (await db.client.query(convexApi.giveaways.listGiveawaysByGuildId, {
            guildId: guildId.value,
            limit: normalizeCreateLimit(input.limit),
        })) as ConvexGiveawayRecord[];

        return ok(giveaways.map(toGiveawayRecord));
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}

export async function findActiveGiveawayByGuildMessageId(
    db: GiveawaysDb,
    input: { guildId: string; messageId: string }
): Promise<Result<GiveawayRecord, GiveawaysRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return findActiveGiveawayByGuildMessageIdPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);

    try {
        const giveaway = (await db.client.query(convexApi.giveaways.findActiveGiveawayByGuildMessageId, {
            guildId: guildId.value,
            messageId: messageId.value,
        })) as ConvexGiveawayRecord | null;

        return giveaway ? ok(toGiveawayRecord(giveaway)) : err({ type: 'not-found' });
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}

export async function updateGiveawayStatus(
    db: GiveawaysDb,
    input: { actorUserId?: string; giveawayId: string; guildId: string; status: string }
): Promise<Result<GiveawayRecord, GiveawaysRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return updateGiveawayStatusPostgres(db, input);

    const existing = await readConvexGiveawayById(db, input);
    const status = normalizeGiveawayStatus(input.status);

    if (existing.isErr()) return err(existing.error);
    if (status.isErr()) return err(status.error);

    const transition = assertAllowedStatusTransition(existing.value.status, status.value);
    if (transition.isErr()) return err(transition.error);

    try {
        const giveaway = (await db.client.mutation(convexApi.giveaways.updateGiveawayStatus, {
            ...(normalizeOptionalText(input.actorUserId)
                ? { actorUserId: normalizeOptionalText(input.actorUserId) }
                : {}),
            giveawayId: existing.value.id,
            guildId: existing.value.guildId,
            status: status.value,
        })) as ConvexGiveawayRecord | null;

        return giveaway ? ok(toGiveawayRecord(giveaway)) : err({ type: 'not-found' });
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}

export async function upsertGiveawayEntry(
    db: GiveawaysDb,
    input: { giveawayId: string; userId: string }
): Promise<Result<GiveawayEntryRecord, GiveawaysRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return upsertGiveawayEntryPostgres(db, input);

    const normalizedInput = normalizeGiveawayEntryInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const entry = (await db.client.mutation(
            convexApi.giveaways.upsertGiveawayEntry,
            normalizedInput.value
        )) as ConvexGiveawayEntryRecord;

        return ok(toGiveawayEntryRecord(entry));
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}

export async function removeGiveawayEntry(
    db: GiveawaysDb,
    input: { giveawayId: string; userId: string }
): Promise<Result<GiveawayEntryRecord, GiveawaysRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return removeGiveawayEntryPostgres(db, input);

    const normalizedInput = normalizeGiveawayEntryInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const entry = (await db.client.mutation(
            convexApi.giveaways.removeGiveawayEntry,
            normalizedInput.value
        )) as ConvexGiveawayEntryRecord | null;

        return entry ? ok(toGiveawayEntryRecord(entry)) : err({ type: 'not-found' });
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}

export async function listActiveGiveawayEntries(
    db: GiveawaysDb,
    input: { giveawayId: string }
): Promise<Result<GiveawayEntryRecord[], GiveawaysRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listActiveGiveawayEntriesPostgres(db, input);

    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');
    if (giveawayId.isErr()) return err(giveawayId.error);

    try {
        const entries = (await db.client.query(convexApi.giveaways.listActiveGiveawayEntries, {
            giveawayId: giveawayId.value,
            limit: 1000,
        })) as ConvexGiveawayEntryRecord[];

        return ok(entries.map(toGiveawayEntryRecord));
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}

export async function listGiveawayWinners(
    db: GiveawaysDb,
    input: { giveawayId: string }
): Promise<Result<GiveawayWinnerRecord[], GiveawaysRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listGiveawayWinnersPostgres(db, input);

    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');
    if (giveawayId.isErr()) return err(giveawayId.error);

    try {
        const winners = (await db.client.query(convexApi.giveaways.listGiveawayWinners, {
            giveawayId: giveawayId.value,
            limit: 1000,
        })) as ConvexGiveawayWinnerRecord[];

        return ok(winners.map(toGiveawayWinnerRecord));
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}

export async function drawGiveawayWinners(
    db: GiveawaysDb,
    input: { actorUserId?: string; giveawayId: string; guildId: string; reroll?: boolean }
): Promise<Result<{ giveaway: GiveawayRecord; winners: GiveawayWinnerRecord[] }, GiveawaysRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return drawGiveawayWinnersPostgres(db, input);

    const existing = await readConvexGiveawayById(db, input);
    if (existing.isErr()) return err(existing.error);
    if (input.reroll && existing.value.status !== 'closed') {
        return err({ from: existing.value.status, to: 'rerolled', type: 'invalid-status-transition' });
    }
    if (!input.reroll && existing.value.status !== 'active' && existing.value.status !== 'closed') {
        return err({ from: existing.value.status, to: 'closed', type: 'invalid-status-transition' });
    }

    try {
        const result = (await db.client.mutation(convexApi.giveaways.drawGiveawayWinners, {
            ...(normalizeOptionalText(input.actorUserId)
                ? { actorUserId: normalizeOptionalText(input.actorUserId) }
                : {}),
            giveawayId: existing.value.id,
            guildId: existing.value.guildId,
            ...(input.reroll === undefined ? {} : { reroll: input.reroll }),
        })) as { giveaway: ConvexGiveawayRecord; winners: ConvexGiveawayWinnerRecord[] };

        return ok({
            giveaway: toGiveawayRecord(result.giveaway),
            winners: result.winners.map(toGiveawayWinnerRecord),
        });
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}

export async function recordGiveawayEvent(
    db: GiveawaysDb,
    input: { actorUserId?: string; details?: Record<string, unknown>; eventType: string; giveawayId: string }
): Promise<Result<GiveawayEventRecord, GiveawaysRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return recordGiveawayEventPostgres(db, input);

    const normalizedInput = normalizeGiveawayEventInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const event = (await db.client.mutation(
            convexApi.giveaways.recordGiveawayEvent,
            normalizedInput.value
        )) as ConvexGiveawayEventRecord;

        return ok(toGiveawayEventRecord(event));
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}

async function readConvexGiveawayById(
    db: ConvexPersistenceDatabase,
    input: { giveawayId: string; guildId: string }
): Promise<Result<ConvexGiveawayRecord, GiveawaysRepositoryError>> {
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (giveawayId.isErr()) return err(giveawayId.error);
    if (guildId.isErr()) return err(guildId.error);

    try {
        const giveaway = (await db.client.query(convexApi.giveaways.findGiveawayById, {
            giveawayId: giveawayId.value,
            guildId: guildId.value,
        })) as ConvexGiveawayRecord | null;

        return giveaway ? ok(giveaway) : err({ type: 'not-found' });
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}

function normalizeGiveawayInput(input: {
    channelId: string;
    config?: Record<string, unknown>;
    createdByUserId?: string;
    description?: string;
    endsAt?: Date | null;
    entryEmoji?: string;
    guildId: string;
    messageId?: string;
    prize: string;
    status?: string;
    title: string;
    winnerCount?: number;
}): Result<Record<string, unknown>, GiveawaysRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const title = normalizeRequiredText(input.title, 'title');
    const prize = normalizeRequiredText(input.prize, 'prize');
    const entryEmoji = normalizeRequiredText(input.entryEmoji ?? '\u{1f389}', 'entryEmoji');
    const winnerCount = normalizePositiveInteger(input.winnerCount ?? 1, 'winnerCount');
    const status = input.status ? normalizeGiveawayStatus(input.status) : undefined;

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (title.isErr()) return err(title.error);
    if (prize.isErr()) return err(prize.error);
    if (entryEmoji.isErr()) return err(entryEmoji.error);
    if (winnerCount.isErr()) return err(winnerCount.error);
    if (winnerCount.value > 25) return err({ field: 'winnerCount', type: 'invalid-value' });
    if (status?.isErr()) return err(status.error);

    return ok({
        channelId: channelId.value,
        config: input.config ?? {},
        ...(normalizeOptionalText(input.createdByUserId)
            ? { createdByUserId: normalizeOptionalText(input.createdByUserId) }
            : {}),
        ...(normalizeOptionalText(input.description) ? { description: normalizeOptionalText(input.description) } : {}),
        ...(input.endsAt ? { endsAt: input.endsAt.toISOString() } : {}),
        entryEmoji: entryEmoji.value,
        guildId: guildId.value,
        ...(normalizeOptionalText(input.messageId) ? { messageId: normalizeOptionalText(input.messageId) } : {}),
        prize: prize.value,
        ...(status?.isOk() ? { status: status.value } : {}),
        title: title.value,
        winnerCount: winnerCount.value,
    });
}

function normalizeGiveawayEntryInput(input: {
    giveawayId: string;
    userId: string;
}): Result<{ giveawayId: string; userId: string }, GiveawaysRepositoryError> {
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (giveawayId.isErr()) return err(giveawayId.error);
    if (userId.isErr()) return err(userId.error);

    return ok({ giveawayId: giveawayId.value, userId: userId.value });
}

function normalizeGiveawayEventInput(input: {
    actorUserId?: string;
    details?: Record<string, unknown>;
    eventType: string;
    giveawayId: string;
}): Result<Record<string, unknown>, GiveawaysRepositoryError> {
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');
    const eventType = normalizeRequiredText(input.eventType, 'eventType');

    if (giveawayId.isErr()) return err(giveawayId.error);
    if (eventType.isErr()) return err(eventType.error);

    return ok({
        ...(normalizeOptionalText(input.actorUserId) ? { actorUserId: normalizeOptionalText(input.actorUserId) } : {}),
        details: input.details ?? {},
        eventType: eventType.value,
        giveawayId: giveawayId.value,
    });
}

function assertAllowedStatusTransition(from: string, to: string): Result<void, GiveawaysRepositoryError> {
    if (from === to) return ok(undefined);
    if (!giveawayStatusTransitions.get(from)?.includes(to)) return err({ from, to, type: 'invalid-status-transition' });

    return ok(undefined);
}
