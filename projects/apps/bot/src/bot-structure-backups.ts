import type { AppLogger } from '@neonflux/core/logging';
import {
    claimDueStructureBackupSetting,
    clearStructureBackupSettingLease,
    createStructureBackup,
    listDueStructureBackupRetentionSettings,
    listDueStructureBackupSettings,
    pruneExpiredStructureBackupsForGuild,
    structureBackupSources,
    structureBackupStatuses,
    type RuntimeDbClient,
} from '@neonflux/db';
import { readFluxerBotGuildStructure, type FluxerGuildStructure } from '@neonflux/fluxer';
import { randomUUID } from 'node:crypto';

type StructureBackupScheduler = {
    stop(): void;
};

type RunDueStructureBackupsInput = {
    botToken: string;
    database: RuntimeDbClient;
    leaseOwner?: string;
    logger: AppLogger;
    now?: Date;
};

const structureBackupSchedulerIntervalMs = 60 * 60 * 1000;
const structureBackupBatchLimit = 25;
const structureBackupLeaseTtlMs = 30 * 60 * 1000;
const structureBackupMaxBatchesPerRun = 20;
const structureBackupRetentionBatchLimit = 25;
const structureBackupRetentionDeleteLimit = 100;

export function startStructureBackupScheduler(input: RunDueStructureBackupsInput): StructureBackupScheduler {
    let running = false;
    const leaseOwner = input.leaseOwner ?? `structure-backup-scheduler:${randomUUID()}`;
    const runOnce = async () => {
        if (running) return;
        running = true;

        try {
            await runDueStructureBackups({ ...input, leaseOwner });
        } finally {
            running = false;
        }
    };
    const interval = setInterval(() => {
        void runOnce();
    }, structureBackupSchedulerIntervalMs);

    void runOnce();

    return {
        stop() {
            clearInterval(interval);
        },
    };
}

export async function runDueStructureBackups({
    botToken,
    database,
    leaseOwner = `structure-backup-run:${randomUUID()}`,
    logger,
    now = new Date(),
}: RunDueStructureBackupsInput): Promise<void> {
    await runDueStructureBackupRetention({ database, logger, now });

    const processedGuildIds = new Set<string>();

    for (let batchIndex = 0; batchIndex < structureBackupMaxBatchesPerRun; batchIndex += 1) {
        const settingsResult = await listDueStructureBackupSettings(database.db, {
            limit: structureBackupBatchLimit,
            now,
        });

        if (settingsResult.isErr()) {
            logger.error('structure.backup_due_lookup_failed', { error: settingsResult.error });
            return;
        }

        const dueSettings = settingsResult.value.filter((settings) => !processedGuildIds.has(settings.guildId));
        if (dueSettings.length === 0) return;

        for (const settings of dueSettings) {
            processedGuildIds.add(settings.guildId);
            const leaseId = randomUUID();
            const claimResult = await claimDueStructureBackupSetting(database.db, {
                guildId: settings.guildId,
                leaseExpiresAt: new Date(now.getTime() + structureBackupLeaseTtlMs),
                leaseId,
                leaseOwner,
                now,
            });

            if (claimResult.isErr()) {
                logger.error('structure.backup_claim_failed', { error: claimResult.error, guildId: settings.guildId });
                continue;
            }
            if (!claimResult.value) continue;

            try {
                const structureResult = await readFluxerBotGuildStructure({
                    botToken,
                    guildId: settings.guildId,
                });

                if (structureResult.isErr()) {
                    const backupResult = await createStructureBackup(database.db, {
                        guildId: settings.guildId,
                        serverName: settings.guildId,
                        source: structureBackupSources.scheduled,
                        status: structureBackupStatuses.failed,
                        errorMessage: `Structure read failed: ${structureResult.error.type}`,
                    });

                    if (backupResult.isErr()) {
                        logger.error('structure.backup_failure_record_failed', {
                            error: backupResult.error,
                            guildId: settings.guildId,
                        });
                    }
                    continue;
                }

                const snapshot = toStructureBackupPayload(structureResult.value, now.toISOString());
                const backupResult = await createStructureBackup(database.db, {
                    guildId: settings.guildId,
                    serverName: structureResult.value.guildName,
                    source: structureBackupSources.scheduled,
                    status: structureBackupStatuses.succeeded,
                    structure: JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>,
                    roleCount: snapshot.roles.length,
                    categoryCount: snapshot.categories.length,
                    channelCount: snapshot.channels.length,
                });

                if (backupResult.isErr()) {
                    logger.error('structure.backup_record_failed', {
                        error: backupResult.error,
                        guildId: settings.guildId,
                    });
                }
            } finally {
                const clearResult = await clearStructureBackupSettingLease(database.db, {
                    guildId: settings.guildId,
                    leaseId,
                    now,
                });

                if (clearResult.isErr()) {
                    logger.error('structure.backup_lease_clear_failed', {
                        error: clearResult.error,
                        guildId: settings.guildId,
                    });
                }
            }
        }

        if (settingsResult.value.length < structureBackupBatchLimit) return;
    }

    logger.warn('structure.backup_due_batch_limit_reached', {
        batchLimit: structureBackupBatchLimit,
        maxBatches: structureBackupMaxBatchesPerRun,
        processedCount: processedGuildIds.size,
    });
}

async function runDueStructureBackupRetention(input: {
    database: RuntimeDbClient;
    logger: AppLogger;
    now: Date;
}): Promise<void> {
    const settingsResult = await listDueStructureBackupRetentionSettings(input.database.db, {
        limit: structureBackupRetentionBatchLimit,
        now: input.now,
    });

    if (settingsResult.isErr()) {
        input.logger.error('structure.backup_retention_due_lookup_failed', { error: settingsResult.error });
        return;
    }

    for (const settings of settingsResult.value) {
        const pruneResult = await pruneExpiredStructureBackupsForGuild(input.database.db, {
            guildId: settings.guildId,
            limit: structureBackupRetentionDeleteLimit,
            now: input.now,
        });

        if (pruneResult.isErr()) {
            input.logger.error('structure.backup_retention_prune_failed', {
                error: pruneResult.error,
                guildId: settings.guildId,
            });
            continue;
        }

        if (pruneResult.value.deletedCount > 0) {
            input.logger.info('structure.backup_retention_pruned', {
                deletedCount: pruneResult.value.deletedCount,
                guildId: settings.guildId,
                hasMore: pruneResult.value.hasMore,
            });
        }
    }
}

function toStructureBackupPayload(
    structure: FluxerGuildStructure,
    exportedAt: string
): Record<string, unknown> & {
    categories: unknown[];
    channels: unknown[];
    roles: unknown[];
} {
    return {
        version: 1,
        guildId: structure.guildId,
        guildName: structure.guildName,
        exportedAt,
        roles: structure.roles,
        categories: structure.categories,
        channels: structure.channels,
    };
}
