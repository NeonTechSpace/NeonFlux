import { api } from '@neonflux/convex-api';
import type {
    GiveawayMaintenanceRepositoryError,
    GiveawayRecord,
    GiveawayReconciliationRepositoryError,
    GiveawaySyncStatus,
} from './contracts-giveaways.js';
import { err, ok, type Result } from 'neverthrow';

import {
    mapGiveawayConvexError,
    normalizeDate,
    normalizeMaintenanceLimit,
    normalizeOptionalText,
    normalizeRequiredText,
    toGiveawayRecord,
} from './runtime-giveaways-records.js';
import type { GiveawaysDb } from './runtime-giveaways.js';

export async function listExpiredActiveGiveaways(
    db: GiveawaysDb,
    input: { limit?: number; now: Date }
): Promise<Result<GiveawayRecord[], GiveawayMaintenanceRepositoryError>> {
    const now = normalizeDate(input.now, 'now');
    if (now.isErr()) return err(now.error);

    try {
        const giveaways = await db.client.query(api.giveaway_maintenance.listExpiredActiveGiveaways, {
            limit: normalizeMaintenanceLimit(input.limit),
            now: now.value,
        });

        return ok(giveaways.map(toGiveawayRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStaleActiveGiveaways(
    db: GiveawaysDb,
    input: { limit?: number } = {}
): Promise<Result<GiveawayRecord[], GiveawayMaintenanceRepositoryError>> {
    try {
        const giveaways = await db.client.query(api.giveaway_maintenance.listStaleActiveGiveaways, {
            limit: normalizeMaintenanceLimit(input.limit),
        });

        return ok(giveaways.map(toGiveawayRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listReactionReconciliationGiveaways(
    db: GiveawaysDb,
    input: { limit?: number } = {}
): Promise<Result<GiveawayRecord[], GiveawayMaintenanceRepositoryError>> {
    try {
        const giveaways = await db.client.query(api.giveaway_maintenance.listReactionReconciliationGiveaways, {
            limit: normalizeMaintenanceLimit(input.limit),
        });

        return ok(giveaways.map(toGiveawayRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateGiveawaySyncStatus(
    db: GiveawaysDb,
    input: { giveawayId: string; guildId: string; syncStatus: GiveawaySyncStatus }
): Promise<Result<GiveawayRecord, GiveawayMaintenanceRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');

    if (guildId.isErr()) return err(guildId.error);
    if (giveawayId.isErr()) return err(giveawayId.error);

    try {
        const giveaway = await db.client.mutation(api.giveaway_maintenance.updateGiveawaySyncStatus, {
            giveawayId: giveawayId.value,
            guildId: guildId.value,
            syncStatus: input.syncStatus,
        });

        return giveaway ? ok(toGiveawayRecord(giveaway)) : err({ type: 'not-found' });
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}

export async function reconcileGiveawayEntries(
    db: GiveawaysDb,
    input: { giveawayId: string; reconciledAt?: Date; userIds: readonly string[] }
): Promise<Result<{ added: number; kept: number; removed: number }, GiveawayReconciliationRepositoryError>> {
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');
    const reconciledAt = input.reconciledAt ? normalizeDate(input.reconciledAt, 'reconciledAt') : undefined;

    if (giveawayId.isErr()) return err(giveawayId.error);
    if (reconciledAt?.isErr()) return err(reconciledAt.error);

    try {
        const result = await db.client.mutation(api.giveaway_reconciliation.reconcileGiveawayEntries, {
            giveawayId: giveawayId.value,
            ...(reconciledAt?.isOk() ? { reconciledAt: reconciledAt.value } : {}),
            userIds: input.userIds
                .map((userId) => normalizeOptionalText(userId))
                .filter((userId): userId is string => Boolean(userId)),
        });

        return ok(result);
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}
