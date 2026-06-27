import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { giveaways } from './schema.js';
import type { GiveawayRecord } from './giveaways.js';

export type GiveawayMaintenanceRepositoryError = GuildFeatureRepositoryError;
export type GiveawaySyncStatus = 'active' | 'stale';

export async function listExpiredActiveGiveaways(
    db: GuildFeatureRepositoryDatabase,
    input: { now: Date; limit?: number }
): Promise<Result<GiveawayRecord[], GiveawayMaintenanceRepositoryError>> {
    const now = normalizeDate(input.now, 'now');

    if (now.isErr()) return err(now.error);

    try {
        return ok(
            await db
                .select()
                .from(giveaways)
                .where(and(eq(giveaways.status, 'active'), lte(giveaways.endsAt, now.value)))
                .orderBy(asc(giveaways.endsAt))
                .limit(normalizeLimit(input.limit))
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStaleActiveGiveaways(
    db: GuildFeatureRepositoryDatabase,
    input: { limit?: number } = {}
): Promise<Result<GiveawayRecord[], GiveawayMaintenanceRepositoryError>> {
    try {
        return ok(
            await db
                .select()
                .from(giveaways)
                .where(
                    and(
                        eq(giveaways.status, 'active'),
                        isNotNull(giveaways.messageId),
                        sql`${giveaways.config}->>'syncStatus' = 'stale'`
                    )
                )
                .orderBy(asc(giveaways.updatedAt))
                .limit(normalizeLimit(input.limit))
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listReactionReconciliationGiveaways(
    db: GuildFeatureRepositoryDatabase,
    input: { limit?: number } = {}
): Promise<Result<GiveawayRecord[], GiveawayMaintenanceRepositoryError>> {
    try {
        return ok(
            await db
                .select()
                .from(giveaways)
                .where(and(eq(giveaways.status, 'active'), isNotNull(giveaways.messageId)))
                .orderBy(asc(giveaways.updatedAt))
                .limit(normalizeLimit(input.limit))
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateGiveawaySyncStatus(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; giveawayId: string; syncStatus: GiveawaySyncStatus }
): Promise<Result<GiveawayRecord, GiveawayMaintenanceRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');

    if (guildId.isErr()) return err(guildId.error);
    if (giveawayId.isErr()) return err(giveawayId.error);

    try {
        const existingRows = await db
            .select()
            .from(giveaways)
            .where(and(eq(giveaways.guildId, guildId.value), eq(giveaways.id, giveawayId.value)))
            .limit(1);
        const existing = existingRows[0];

        if (!existing) return err({ type: 'not-found' });

        const rows = await db
            .update(giveaways)
            .set({
                config: {
                    ...existing.config,
                    syncStatus: input.syncStatus,
                },
                updatedAt: new Date(),
            })
            .where(and(eq(giveaways.guildId, guildId.value), eq(giveaways.id, giveawayId.value)))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeDate(value: Date, field: string): Result<Date, GiveawayMaintenanceRepositoryError> {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        return err({ type: 'invalid-value', field });
    }

    return ok(value);
}

function normalizeLimit(limit: number | undefined): number {
    return Number.isInteger(limit) && limit && limit > 0 ? Math.min(limit, 100) : 25;
}
