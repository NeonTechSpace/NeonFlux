import { randomInt } from 'node:crypto';

import { and, asc, desc, eq, isNull, max } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    assertAllowedStatusTransition,
    normalizeNonNegativeInteger,
    normalizeOptionalText,
    normalizeRequiredPositiveInteger,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { giveawayEntries, giveawayEvents, giveaways, giveawayWinners } from './schema.js';

export type GiveawayRecord = typeof giveaways.$inferSelect;
export type GiveawayEntryRecord = typeof giveawayEntries.$inferSelect;
export type GiveawayWinnerRecord = typeof giveawayWinners.$inferSelect;
export type GiveawayEventRecord = typeof giveawayEvents.$inferSelect;
export type GiveawaysRepositoryError = GuildFeatureRepositoryError;

const giveawayStatusTransitions = new Map<string, readonly string[]>([
    ['draft', ['active', 'cancelled']],
    ['active', ['closed', 'cancelled']],
    ['closed', []],
    ['cancelled', []],
]);

export async function createGiveaway(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        channelId: string;
        title: string;
        prize: string;
        messageId?: string;
        description?: string;
        entryEmoji?: string;
        winnerCount?: number;
        status?: string;
        endsAt?: Date | null;
        createdByUserId?: string;
        config?: Record<string, unknown>;
    }
): Promise<Result<GiveawayRecord, GiveawaysRepositoryError>> {
    const payload = normalizeGiveawayPayload(input);

    if (payload.isErr()) return err(payload.error);

    try {
        const rows = await db
            .insert(giveaways)
            .values({
                ...payload.value,
                messageId: normalizeOptionalText(input.messageId),
                status: input.status ?? 'draft',
                endsAt: input.endsAt ?? null,
                createdByUserId: normalizeOptionalText(input.createdByUserId),
                config: input.config ?? {},
                updatedAt: new Date(),
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listGiveawaysByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; limit?: number }
): Promise<Result<GiveawayRecord[], GiveawaysRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(giveaways)
            .where(eq(giveaways.guildId, guildId.value))
            .orderBy(desc(giveaways.createdAt))
            .limit(normalizeListLimit(input.limit));

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findGiveawayById(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; giveawayId: string }
): Promise<Result<GiveawayRecord, GiveawaysRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');

    if (guildId.isErr()) return err(guildId.error);
    if (giveawayId.isErr()) return err(giveawayId.error);

    try {
        const rows = await db
            .select()
            .from(giveaways)
            .where(and(eq(giveaways.guildId, guildId.value), eq(giveaways.id, giveawayId.value)))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findActiveGiveawayByGuildMessageId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; messageId: string }
): Promise<Result<GiveawayRecord, GiveawaysRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);

    try {
        const rows = await db
            .select()
            .from(giveaways)
            .where(
                and(
                    eq(giveaways.guildId, guildId.value),
                    eq(giveaways.messageId, messageId.value),
                    eq(giveaways.status, 'active')
                )
            )
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateGiveawayStatus(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; giveawayId: string; status: string; actorUserId?: string }
): Promise<Result<GiveawayRecord, GiveawaysRepositoryError>> {
    const existingResult = await findGiveawayById(db, input);
    const status = normalizeRequiredText(input.status, 'status');

    if (existingResult.isErr()) return err(existingResult.error);
    if (status.isErr()) return err(status.error);

    const transition = assertAllowedStatusTransition(
        existingResult.value.status,
        status.value,
        giveawayStatusTransitions
    );

    if (transition.isErr()) return err(transition.error);

    try {
        const rows = await db
            .update(giveaways)
            .set({
                status: status.value,
                closedByUserId:
                    status.value === 'closed' || status.value === 'cancelled'
                        ? normalizeOptionalText(input.actorUserId)
                        : existingResult.value.closedByUserId,
                closedAt:
                    status.value === 'closed' || status.value === 'cancelled'
                        ? new Date()
                        : existingResult.value.closedAt,
                updatedAt: new Date(),
            })
            .where(and(eq(giveaways.guildId, input.guildId), eq(giveaways.id, input.giveawayId)))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertGiveawayEntry(
    db: GuildFeatureRepositoryDatabase,
    input: { giveawayId: string; userId: string }
): Promise<Result<GiveawayEntryRecord, GiveawaysRepositoryError>> {
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const now = new Date();

    if (giveawayId.isErr()) return err(giveawayId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const rows = await db
            .insert(giveawayEntries)
            .values({
                giveawayId: giveawayId.value,
                userId: userId.value,
                enteredAt: now,
                removedAt: null,
            })
            .onConflictDoUpdate({
                target: [giveawayEntries.giveawayId, giveawayEntries.userId],
                set: {
                    removedAt: null,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function removeGiveawayEntry(
    db: GuildFeatureRepositoryDatabase,
    input: { giveawayId: string; userId: string }
): Promise<Result<GiveawayEntryRecord, GiveawaysRepositoryError>> {
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (giveawayId.isErr()) return err(giveawayId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const rows = await db
            .update(giveawayEntries)
            .set({ removedAt: new Date() })
            .where(
                and(
                    eq(giveawayEntries.giveawayId, giveawayId.value),
                    eq(giveawayEntries.userId, userId.value),
                    isNull(giveawayEntries.removedAt)
                )
            )
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listActiveGiveawayEntries(
    db: GuildFeatureRepositoryDatabase,
    input: { giveawayId: string }
): Promise<Result<GiveawayEntryRecord[], GiveawaysRepositoryError>> {
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');

    if (giveawayId.isErr()) return err(giveawayId.error);

    try {
        const rows = await db
            .select()
            .from(giveawayEntries)
            .where(and(eq(giveawayEntries.giveawayId, giveawayId.value), isNull(giveawayEntries.removedAt)))
            .orderBy(asc(giveawayEntries.enteredAt));

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listGiveawayWinners(
    db: GuildFeatureRepositoryDatabase,
    input: { giveawayId: string }
): Promise<Result<GiveawayWinnerRecord[], GiveawaysRepositoryError>> {
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');

    if (giveawayId.isErr()) return err(giveawayId.error);

    try {
        const rows = await db
            .select()
            .from(giveawayWinners)
            .where(eq(giveawayWinners.giveawayId, giveawayId.value))
            .orderBy(desc(giveawayWinners.drawNumber), asc(giveawayWinners.selectedAt));

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function drawGiveawayWinners(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; giveawayId: string; actorUserId?: string; reroll?: boolean }
): Promise<Result<{ giveaway: GiveawayRecord; winners: GiveawayWinnerRecord[] }, GiveawaysRepositoryError>> {
    const giveawayResult = await findGiveawayById(db, input);

    if (giveawayResult.isErr()) return err(giveawayResult.error);
    if (input.reroll && giveawayResult.value.status !== 'closed') {
        return err({ type: 'invalid-status-transition', from: giveawayResult.value.status, to: 'rerolled' });
    }
    if (!input.reroll && giveawayResult.value.status !== 'active' && giveawayResult.value.status !== 'closed') {
        return err({ type: 'invalid-status-transition', from: giveawayResult.value.status, to: 'closed' });
    }

    const entriesResult = await listActiveGiveawayEntries(db, { giveawayId: input.giveawayId });
    const existingWinnersResult = await listGiveawayWinners(db, { giveawayId: input.giveawayId });

    if (entriesResult.isErr()) return err(entriesResult.error);
    if (existingWinnersResult.isErr()) return err(existingWinnersResult.error);

    if (!input.reroll && giveawayResult.value.status === 'closed') {
        return ok({
            giveaway: giveawayResult.value,
            winners: existingWinnersResult.value.filter((winner) => winner.drawNumber === 1),
        });
    }

    const drawNumber = input.reroll ? getNextDrawNumber(existingWinnersResult.value) : 1;
    const excludedUserIds = input.reroll
        ? new Set(existingWinnersResult.value.map((winner) => winner.userId))
        : new Set<string>();
    const winnerUserIds = pickWinners(entriesResult.value, giveawayResult.value.winnerCount, excludedUserIds);

    try {
        const result = await db.transaction(async (tx) => {
            const giveaway = input.reroll
                ? giveawayResult.value
                : (
                      await tx
                          .update(giveaways)
                          .set({
                              status: 'closed',
                              closedByUserId: normalizeOptionalText(input.actorUserId),
                              closedAt: new Date(),
                              updatedAt: new Date(),
                          })
                          .where(
                              and(
                                  eq(giveaways.guildId, input.guildId),
                                  eq(giveaways.id, input.giveawayId),
                                  eq(giveaways.status, 'active')
                              )
                          )
                          .returning()
                  )[0];

            if (!giveaway) return undefined;

            const winners =
                winnerUserIds.length > 0
                    ? await tx
                          .insert(giveawayWinners)
                          .values(
                              winnerUserIds.map((userId) => ({
                                  giveawayId: input.giveawayId,
                                  userId,
                                  drawNumber,
                              }))
                          )
                          .returning()
                    : [];

            await tx.insert(giveawayEvents).values({
                giveawayId: input.giveawayId,
                eventType: input.reroll ? 'rerolled' : 'closed',
                actorUserId: normalizeOptionalText(input.actorUserId),
                details: { drawNumber, winnerCount: winners.length },
            });

            return { giveaway, winners };
        });

        if (result) return ok(result);

        const refreshedGiveawayResult = await findGiveawayById(db, input);
        const refreshedWinnersResult = await listGiveawayWinners(db, { giveawayId: input.giveawayId });

        if (refreshedGiveawayResult.isErr()) return err(refreshedGiveawayResult.error);
        if (refreshedWinnersResult.isErr()) return err(refreshedWinnersResult.error);
        if (refreshedGiveawayResult.value.status === 'closed') {
            return ok({
                giveaway: refreshedGiveawayResult.value,
                winners: refreshedWinnersResult.value.filter((winner) => winner.drawNumber === 1),
            });
        }

        return err({
            type: 'invalid-status-transition',
            from: refreshedGiveawayResult.value.status,
            to: 'closed',
        });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordGiveawayEvent(
    db: GuildFeatureRepositoryDatabase,
    input: { giveawayId: string; eventType: string; actorUserId?: string; details?: Record<string, unknown> }
): Promise<Result<GiveawayEventRecord, GiveawaysRepositoryError>> {
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');
    const eventType = normalizeRequiredText(input.eventType, 'eventType');

    if (giveawayId.isErr()) return err(giveawayId.error);
    if (eventType.isErr()) return err(eventType.error);

    try {
        const rows = await db
            .insert(giveawayEvents)
            .values({
                giveawayId: giveawayId.value,
                eventType: eventType.value,
                actorUserId: normalizeOptionalText(input.actorUserId),
                details: input.details ?? {},
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function readGiveawayEntryCount(
    db: GuildFeatureRepositoryDatabase,
    input: { giveawayId: string }
): Promise<Result<number, GiveawaysRepositoryError>> {
    const entriesResult = await listActiveGiveawayEntries(db, input);

    return entriesResult.isOk() ? ok(entriesResult.value.length) : err(entriesResult.error);
}

export async function readLatestGiveawayDrawNumber(
    db: GuildFeatureRepositoryDatabase,
    input: { giveawayId: string }
): Promise<Result<number, GiveawaysRepositoryError>> {
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');

    if (giveawayId.isErr()) return err(giveawayId.error);

    try {
        const rows = await db
            .select({ drawNumber: max(giveawayWinners.drawNumber) })
            .from(giveawayWinners)
            .where(eq(giveawayWinners.giveawayId, giveawayId.value));

        return ok(rows[0]?.drawNumber ?? 0);
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeGiveawayPayload(input: {
    guildId: string;
    channelId: string;
    title: string;
    prize: string;
    description?: string;
    entryEmoji?: string;
    winnerCount?: number;
}): Result<
    {
        guildId: string;
        channelId: string;
        title: string;
        prize: string;
        description: string | null;
        entryEmoji: string;
        winnerCount: number;
    },
    GiveawaysRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const title = normalizeRequiredText(input.title, 'title');
    const prize = normalizeRequiredText(input.prize, 'prize');
    const winnerCount = normalizeRequiredPositiveInteger(input.winnerCount ?? 1, 'winnerCount');
    const entryEmoji = normalizeRequiredText(input.entryEmoji ?? '🎉', 'entryEmoji');

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (title.isErr()) return err(title.error);
    if (prize.isErr()) return err(prize.error);
    if (winnerCount.isErr()) return err(winnerCount.error);
    if (entryEmoji.isErr()) return err(entryEmoji.error);
    if (winnerCount.value > 25) return err({ type: 'invalid-value', field: 'winnerCount' });

    return ok({
        guildId: guildId.value,
        channelId: channelId.value,
        title: title.value,
        prize: prize.value,
        description: normalizeOptionalText(input.description) ?? null,
        entryEmoji: entryEmoji.value,
        winnerCount: winnerCount.value,
    });
}

function pickWinners(
    entries: readonly GiveawayEntryRecord[],
    winnerCount: number,
    excludedUserIds: ReadonlySet<string>
): string[] {
    const candidates = entries.map((entry) => entry.userId).filter((userId) => !excludedUserIds.has(userId));
    const winners: string[] = [];

    while (candidates.length > 0 && winners.length < winnerCount) {
        const index = randomInt(candidates.length);
        const [winner] = candidates.splice(index, 1);

        if (winner) {
            winners.push(winner);
        }
    }

    return winners;
}

function getNextDrawNumber(winners: readonly GiveawayWinnerRecord[]): number {
    return Math.max(0, ...winners.map((winner) => winner.drawNumber)) + 1;
}

function normalizeListLimit(limit: number | undefined): number {
    const normalizedLimit = normalizeNonNegativeInteger(limit ?? 50, 'limit');

    return normalizedLimit.isOk() ? Math.min(Math.max(normalizedLimit.value, 1), 100) : 50;
}
