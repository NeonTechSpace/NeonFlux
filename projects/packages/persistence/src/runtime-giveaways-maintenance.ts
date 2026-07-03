import { api } from '@neonflux/convex/api';
import {
    listExpiredActiveGiveaways as listExpiredActiveGiveawaysPostgres,
    listReactionReconciliationGiveaways as listReactionReconciliationGiveawaysPostgres,
    listStaleActiveGiveaways as listStaleActiveGiveawaysPostgres,
    reconcileGiveawayEntries as reconcileGiveawayEntriesPostgres,
    updateGiveawaySyncStatus as updateGiveawaySyncStatusPostgres,
    type GiveawayMaintenanceRepositoryError,
    type GiveawayRecord,
    type GiveawayReconciliationRepositoryError,
    type GiveawaySyncStatus,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { isConvexPersistenceDatabase, type ConvexPersistenceDatabase } from './convex.js';
import {
    mapGiveawayConvexError,
    normalizeDate,
    normalizeMaintenanceLimit,
    normalizeOptionalText,
    normalizeRequiredText,
    toGiveawayRecord,
    type ConvexGiveawayRecord,
} from './runtime-giveaways-records.js';
import type { GiveawaysDb } from './runtime-giveaways.js';

type ConvexQueryReference = Parameters<ConvexPersistenceDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexPersistenceDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    giveaway_maintenance: {
        listExpiredActiveGiveaways: ConvexQueryReference;
        listReactionReconciliationGiveaways: ConvexQueryReference;
        listStaleActiveGiveaways: ConvexQueryReference;
        updateGiveawaySyncStatus: ConvexMutationReference;
    };
    giveaway_reconciliation: {
        reconcileGiveawayEntries: ConvexMutationReference;
    };
};

export async function listExpiredActiveGiveaways(
    db: GiveawaysDb,
    input: { limit?: number; now: Date }
): Promise<Result<GiveawayRecord[], GiveawayMaintenanceRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listExpiredActiveGiveawaysPostgres(db, input);

    const now = normalizeDate(input.now, 'now');
    if (now.isErr()) return err(now.error);

    try {
        const giveaways = (await db.client.query(convexApi.giveaway_maintenance.listExpiredActiveGiveaways, {
            limit: normalizeMaintenanceLimit(input.limit),
            now: now.value,
        })) as ConvexGiveawayRecord[];

        return ok(giveaways.map(toGiveawayRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStaleActiveGiveaways(
    db: GiveawaysDb,
    input: { limit?: number } = {}
): Promise<Result<GiveawayRecord[], GiveawayMaintenanceRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listStaleActiveGiveawaysPostgres(db, input);

    try {
        const giveaways = (await db.client.query(convexApi.giveaway_maintenance.listStaleActiveGiveaways, {
            limit: normalizeMaintenanceLimit(input.limit),
        })) as ConvexGiveawayRecord[];

        return ok(giveaways.map(toGiveawayRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listReactionReconciliationGiveaways(
    db: GiveawaysDb,
    input: { limit?: number } = {}
): Promise<Result<GiveawayRecord[], GiveawayMaintenanceRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listReactionReconciliationGiveawaysPostgres(db, input);

    try {
        const giveaways = (await db.client.query(convexApi.giveaway_maintenance.listReactionReconciliationGiveaways, {
            limit: normalizeMaintenanceLimit(input.limit),
        })) as ConvexGiveawayRecord[];

        return ok(giveaways.map(toGiveawayRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateGiveawaySyncStatus(
    db: GiveawaysDb,
    input: { giveawayId: string; guildId: string; syncStatus: GiveawaySyncStatus }
): Promise<Result<GiveawayRecord, GiveawayMaintenanceRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return updateGiveawaySyncStatusPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');

    if (guildId.isErr()) return err(guildId.error);
    if (giveawayId.isErr()) return err(giveawayId.error);

    try {
        const giveaway = (await db.client.mutation(convexApi.giveaway_maintenance.updateGiveawaySyncStatus, {
            giveawayId: giveawayId.value,
            guildId: guildId.value,
            syncStatus: input.syncStatus,
        })) as ConvexGiveawayRecord | null;

        return giveaway ? ok(toGiveawayRecord(giveaway)) : err({ type: 'not-found' });
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}

export async function reconcileGiveawayEntries(
    db: GiveawaysDb,
    input: { giveawayId: string; reconciledAt?: Date; userIds: readonly string[] }
): Promise<Result<{ added: number; kept: number; removed: number }, GiveawayReconciliationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return reconcileGiveawayEntriesPostgres(db, input);

    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');
    const reconciledAt = input.reconciledAt ? normalizeDate(input.reconciledAt, 'reconciledAt') : undefined;

    if (giveawayId.isErr()) return err(giveawayId.error);
    if (reconciledAt?.isErr()) return err(reconciledAt.error);

    try {
        const result = (await db.client.mutation(convexApi.giveaway_reconciliation.reconcileGiveawayEntries, {
            giveawayId: giveawayId.value,
            ...(reconciledAt?.isOk() ? { reconciledAt: reconciledAt.value } : {}),
            userIds: input.userIds.map((userId) => normalizeOptionalText(userId)).filter(Boolean),
        })) as { added: number; kept: number; removed: number };

        return ok(result);
    } catch (error) {
        return err(mapGiveawayConvexError(error));
    }
}
