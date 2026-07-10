import type { AppLogger } from '@neonflux/core/logging';
import {
    claimDueStructureBackupSetting,
    claimDueStructureDriftSetting,
    clearStructureBackupSettingLease,
    clearStructureDriftSettingLease,
    createStructureBackup,
    findLatestStructureDriftBaselineBackupByGuildId,
    listDueStructureBackupRetentionSettings,
    listDueStructureBackupSettings,
    listDueStructureDriftSettings,
    pruneExpiredStructureBackupsForGuild,
    recordStructureScheduledDriftResult,
    structureAuditActions,
    structureBackupSources,
    structureBackupStatuses,
    structureScheduledDriftStatuses,
    type RuntimeDbClient,
    type StructureBackupRecord,
} from '@neonflux/db';
import {
    countFluxerGuildStructurePlanChanges,
    diffFluxerGuildStructureSnapshot,
    normalizeFluxerGuildStructureSnapshot,
    readFluxerGuildStructure,
    type FluxerBot,
    summarizeFluxerGuildStructurePlanFields,
    toFluxerGuildStructureSnapshot,
    type FluxerGuildStructure,
} from '@neonflux/fluxer';
import { randomUUID } from 'node:crypto';

type StructureBackupScheduler = {
    stop(): Promise<void>;
};

type RunDueStructureBackupsInput = {
    client: FluxerBot['client'];
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
const structureDriftBatchLimit = 25;
const structureDriftPreviewLimit = 100;

export function startStructureBackupScheduler(input: RunDueStructureBackupsInput): StructureBackupScheduler {
    let running: Promise<void> | undefined;
    const leaseOwner = input.leaseOwner ?? `structure-backup-scheduler:${randomUUID()}`;
    const runOnce = async () => {
        if (running) return;
        running = runDueStructureBackups({ ...input, leaseOwner }).finally(() => {
            running = undefined;
        });
        await running;
    };
    const interval = setInterval(() => {
        void runOnce();
    }, structureBackupSchedulerIntervalMs);

    void runOnce();

    return {
        async stop() {
            clearInterval(interval);
            await running;
        },
    };
}

export async function runDueStructureBackups({
    client,
    database,
    leaseOwner = `structure-backup-run:${randomUUID()}`,
    logger,
    now = new Date(),
}: RunDueStructureBackupsInput): Promise<void> {
    await runDueStructureBackupRetention({ database, logger, now });
    await runDueStructureDriftMonitoring({ client, database, leaseOwner, logger, now });

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
                const structureResult = await readFluxerGuildStructure({
                    client,
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

async function runDueStructureDriftMonitoring({
    client,
    database,
    leaseOwner,
    logger,
    now,
}: Required<
    Pick<RunDueStructureBackupsInput, 'client' | 'database' | 'leaseOwner' | 'logger' | 'now'>
>): Promise<void> {
    const processedGuildIds = new Set<string>();

    for (let batchIndex = 0; batchIndex < structureBackupMaxBatchesPerRun; batchIndex += 1) {
        const settingsResult = await listDueStructureDriftSettings(database.db, {
            limit: structureDriftBatchLimit,
            now,
        });

        if (settingsResult.isErr()) {
            logger.error('structure.scheduled_drift_due_lookup_failed', { error: settingsResult.error });
            return;
        }

        const dueSettings = settingsResult.value.filter((settings) => !processedGuildIds.has(settings.guildId));
        if (dueSettings.length === 0) return;

        for (const settings of dueSettings) {
            processedGuildIds.add(settings.guildId);
            const leaseId = randomUUID();
            const claimResult = await claimDueStructureDriftSetting(database.db, {
                guildId: settings.guildId,
                leaseExpiresAt: new Date(now.getTime() + structureBackupLeaseTtlMs),
                leaseId,
                leaseOwner,
                now,
            });

            if (claimResult.isErr()) {
                logger.error('structure.scheduled_drift_claim_failed', {
                    error: claimResult.error,
                    guildId: settings.guildId,
                });
                continue;
            }
            if (!claimResult.value) continue;

            try {
                await checkScheduledStructureDrift({ client, database, guildId: settings.guildId, logger, now });
            } finally {
                const clearResult = await clearStructureDriftSettingLease(database.db, {
                    guildId: settings.guildId,
                    leaseId,
                    now,
                });

                if (clearResult.isErr()) {
                    logger.error('structure.scheduled_drift_lease_clear_failed', {
                        error: clearResult.error,
                        guildId: settings.guildId,
                    });
                }
            }
        }

        if (settingsResult.value.length < structureDriftBatchLimit) return;
    }

    logger.warn('structure.scheduled_drift_due_batch_limit_reached', {
        batchLimit: structureDriftBatchLimit,
        maxBatches: structureBackupMaxBatchesPerRun,
        processedCount: processedGuildIds.size,
    });
}

async function checkScheduledStructureDrift(input: {
    client: FluxerBot['client'];
    database: RuntimeDbClient;
    guildId: string;
    logger: AppLogger;
    now: Date;
}): Promise<void> {
    const baselineResult = await findLatestStructureDriftBaselineBackupByGuildId(input.database.db, {
        guildId: input.guildId,
    });

    if (baselineResult.isErr()) {
        await recordScheduledDrift(input, {
            errorMessage: 'No successful regular backup is available.',
            status: structureScheduledDriftStatuses.noBaseline,
        });
        return;
    }

    const baselineSnapshot = normalizeFluxerGuildStructureSnapshot(baselineResult.value.structure);
    if (baselineSnapshot.type !== 'valid') {
        await recordScheduledDrift(input, {
            baseline: baselineResult.value,
            errorMessage: baselineSnapshot.message,
            status: structureScheduledDriftStatuses.failed,
        });
        return;
    }

    const structureResult = await readFluxerGuildStructure({
        client: input.client,
        guildId: input.guildId,
    });

    if (structureResult.isErr()) {
        await recordScheduledDrift(input, {
            baseline: baselineResult.value,
            errorMessage: `Structure read failed: ${structureResult.error.type}`,
            status: structureScheduledDriftStatuses.failed,
        });
        return;
    }

    const liveSnapshot = toFluxerGuildStructureSnapshot(structureResult.value, input.now.toISOString());
    const plan = diffFluxerGuildStructureSnapshot(liveSnapshot, baselineSnapshot.snapshot, { policy: 'merge' });
    const changeCount = countFluxerGuildStructurePlanChanges(plan.summary);
    const status = changeCount > 0 ? structureScheduledDriftStatuses.changed : structureScheduledDriftStatuses.clean;

    await recordScheduledDrift(input, {
        baseline: baselineResult.value,
        changeCount,
        fieldSummary: summarizeFluxerGuildStructurePlanFields(plan),
        hasMorePreview: plan.actions.length > structureDriftPreviewLimit,
        liveCounts: {
            categories: liveSnapshot.categories.length,
            channels: liveSnapshot.channels.length,
            roles: liveSnapshot.roles.length,
        },
        status,
        summary: plan.summary,
    });

    if (changeCount > 0) {
        input.logger.info('structure.scheduled_drift_detected', {
            changeCount,
            guildId: input.guildId,
            baselineBackupId: baselineResult.value.id,
        });
    }
}

async function recordScheduledDrift(
    input: {
        database: RuntimeDbClient;
        guildId: string;
        logger: AppLogger;
        now: Date;
    },
    result: {
        baseline?: StructureBackupRecord;
        changeCount?: number;
        errorMessage?: string;
        fieldSummary?: Record<string, unknown>;
        hasMorePreview?: boolean;
        liveCounts?: Record<string, unknown>;
        status: string;
        summary?: Record<string, unknown>;
    }
): Promise<void> {
    const audit = toScheduledDriftAudit(input.guildId, result);
    const recordResult = await recordStructureScheduledDriftResult(input.database.db, {
        ...(audit ? { audit } : {}),
        ...(result.baseline?.id ? { baselineBackupId: result.baseline.id } : {}),
        ...(result.baseline?.name ? { baselineName: result.baseline.name } : {}),
        ...(result.changeCount !== undefined ? { changeCount: result.changeCount } : {}),
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
        ...(result.fieldSummary ? { fieldSummary: result.fieldSummary } : {}),
        guildId: input.guildId,
        ...(result.hasMorePreview !== undefined ? { hasMorePreview: result.hasMorePreview } : {}),
        ...(result.liveCounts ? { liveCounts: result.liveCounts } : {}),
        now: input.now,
        status: result.status,
        ...(result.summary ? { summary: result.summary } : {}),
    });

    if (recordResult.isErr()) {
        input.logger.error('structure.scheduled_drift_record_failed', {
            error: recordResult.error,
            guildId: input.guildId,
            status: result.status,
        });
    }
}

function toScheduledDriftAudit(
    guildId: string,
    result: {
        baseline?: StructureBackupRecord;
        changeCount?: number;
        errorMessage?: string;
        status: string;
    }
) {
    if (result.status === structureScheduledDriftStatuses.changed) {
        return {
            action: structureAuditActions.scheduledDriftDetected,
            metadata: {
                baselineBackupId: result.baseline?.id,
                baselineName: result.baseline?.name,
                changeCount: result.changeCount ?? 0,
                source: 'scheduled_drift',
            },
            targetId: guildId,
        };
    }

    if (result.status === structureScheduledDriftStatuses.failed) {
        return {
            action: structureAuditActions.scheduledDriftFailed,
            metadata: {
                baselineBackupId: result.baseline?.id,
                baselineName: result.baseline?.name,
                errorMessage: result.errorMessage,
                source: 'scheduled_drift',
            },
            targetId: guildId,
        };
    }

    return undefined;
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
            audit: {
                action: structureAuditActions.backupRetentionPruned,
                metadata: {
                    source: 'scheduled_retention',
                },
                targetId: settings.guildId,
            },
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
    return toFluxerGuildStructureSnapshot(structure, exportedAt);
}
