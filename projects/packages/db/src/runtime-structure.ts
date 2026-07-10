import { api } from '@neonflux/convex-api';
import type {
    StructureBackupRecord,
    StructureBackupRetentionPruneRecord,
    StructureBackupSettingsRecord,
    StructureBackupSummaryPageRecord,
    StructureBackupSummaryRecord,
    StructureImportActionPageRecord,
    StructureImportActionRecord,
    StructureImportExportRepositoryError,
    StructureImportRunRecord,
    StructureImportRunWithActionsRecord,
    StructureObservedEventStateRecord,
} from './contracts-structure.js';
import { err, ok, type Result } from 'neverthrow';

import type { ConvexDatabase } from './convex.js';
import { compactConvexArgs } from './convex-args.js';
import {
    normalizeCadenceWeeks,
    normalizeBackupName,
    normalizeLimit,
    normalizeOptionalText,
    normalizeRetentionDays,
    normalizeRequiredText,
    toBackupRetentionPruneRecord,
    toBackupRecord,
    toBackupSettingsRecord,
    toBackupSummaryPageRecord,
    toBackupSummaryRecord,
    toImportActionPageRecord,
    toImportActionRecord,
    toImportRunRecord,
    toObservedEventStateRecord,
} from './runtime-structure-records.js';

type StructureDb = ConvexDatabase;
type StructureAuditInput = {
    action: string;
    actorUserId?: string;
    metadata?: Record<string, unknown>;
    targetId?: string;
};

const importActionPageSize = 100;

export async function findStructureObservedEventStateByGuildId(
    db: StructureDb,
    input: { guildId: string }
): Promise<Result<StructureObservedEventStateRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const state = await db.client.query(api.structure.findStructureObservedEventStateByGuildId, {
            guildId: guildId.value,
        });

        return ok(toObservedEventStateRecord(state));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordStructureObservedEvent(
    db: StructureDb,
    input: { eventType: string; guildId: string; targetId?: string; targetType: string }
): Promise<Result<StructureObservedEventStateRecord, StructureImportExportRepositoryError>> {
    const normalizedInput = normalizeObservedEventInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const state = await db.client.mutation(api.structure.recordStructureObservedEvent, normalizedInput.value);

        return ok(toObservedEventStateRecord(state));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createStructureBackup(
    db: StructureDb,
    input: {
        categoryCount?: number;
        channelCount?: number;
        createdByUserId?: string;
        errorMessage?: string;
        guildId: string;
        name?: string;
        roleCount?: number;
        serverName?: string;
        source?: string;
        status?: string;
        structure?: Record<string, unknown>;
        audit?: StructureAuditInput;
    }
): Promise<Result<StructureBackupRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const backup = await db.client.mutation(
            api.structure.createStructureBackup,
            compactConvexArgs({
                categoryCount: input.categoryCount,
                channelCount: input.channelCount,
                createdByUserId: normalizeOptionalText(input.createdByUserId),
                errorMessage: normalizeOptionalText(input.errorMessage),
                guildId: guildId.value,
                name: normalizeOptionalText(input.name),
                roleCount: input.roleCount,
                serverName: normalizeOptionalText(input.serverName),
                source: normalizeOptionalText(input.source),
                status: normalizeOptionalText(input.status),
                structure: input.structure,
                audit: normalizeStructureAuditInput(input.audit),
            })
        );

        return ok(toBackupRecord(backup));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStructureBackupsByGuildId(
    db: StructureDb,
    input: { guildId: string; limit?: number }
): Promise<Result<StructureBackupRecord[], StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const backups = await db.client.query(api.structure.listStructureBackupsByGuildId, {
            guildId: guildId.value,
            limit: limit.value,
        });

        return ok(backups.map(toBackupRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStructureBackupSummariesByGuildId(
    db: StructureDb,
    input: { guildId: string; limit?: number }
): Promise<Result<StructureBackupSummaryRecord[], StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const backups = await db.client.query(api.structure.listStructureBackupSummariesByGuildId, {
            guildId: guildId.value,
            limit: limit.value,
        });

        return ok(backups.map(toBackupSummaryRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStructureBackupSummaryPageByGuildId(
    db: StructureDb,
    input: { cursor?: string; guildId: string; limit?: number }
): Promise<Result<StructureBackupSummaryPageRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const page = await db.client.query(
            api.structure.listStructureBackupSummaryPageByGuildId,
            compactConvexArgs({
                cursor: normalizeOptionalText(input.cursor),
                guildId: guildId.value,
                limit: limit.value,
            })
        );

        return ok(toBackupSummaryPageRecord(page));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function renameStructureBackup(
    db: StructureDb,
    input: { backupId: string; guildId: string; name: string; audit?: StructureAuditInput }
): Promise<Result<StructureBackupSummaryRecord, StructureImportExportRepositoryError>> {
    const backupId = normalizeRequiredText(input.backupId, 'backupId');
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeBackupName(input.name);

    if (backupId.isErr()) return err(backupId.error);
    if (guildId.isErr()) return err(guildId.error);
    if (name.isErr()) return err(name.error);

    try {
        const backup = await db.client.mutation(
            api.structure.renameStructureBackup,
            compactConvexArgs({
                audit: normalizeStructureAuditInput(input.audit),
                backupId: backupId.value,
                guildId: guildId.value,
                name: name.value,
            })
        );

        return backup ? ok(toBackupSummaryRecord(backup)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteStructureBackup(
    db: StructureDb,
    input: { backupId: string; guildId: string; audit?: StructureAuditInput }
): Promise<Result<boolean, StructureImportExportRepositoryError>> {
    const backupId = normalizeRequiredText(input.backupId, 'backupId');
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (backupId.isErr()) return err(backupId.error);
    if (guildId.isErr()) return err(guildId.error);

    try {
        const deleted = await db.client.mutation(
            api.structure.deleteStructureBackup,
            compactConvexArgs({
                audit: normalizeStructureAuditInput(input.audit),
                backupId: backupId.value,
                guildId: guildId.value,
            })
        );

        return deleted ? ok(true) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findStructureBackupByGuildId(
    db: StructureDb,
    input: { backupId: string; guildId: string }
): Promise<Result<StructureBackupRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const backupId = normalizeRequiredText(input.backupId, 'backupId');

    if (guildId.isErr()) return err(guildId.error);
    if (backupId.isErr()) return err(backupId.error);

    try {
        const backup = await db.client.query(api.structure.findStructureBackupByGuildId, {
            backupId: backupId.value,
            guildId: guildId.value,
        });

        return backup ? ok(toBackupRecord(backup)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findLatestStructureDriftBaselineBackupByGuildId(
    db: StructureDb,
    input: { guildId: string }
): Promise<Result<StructureBackupRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const backup = await db.client.query(api.structure.findLatestStructureDriftBaselineBackupByGuildId, {
            guildId: guildId.value,
        });

        return backup ? ok(toBackupRecord(backup)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findStructureBackupSettingsByGuildId(
    db: StructureDb,
    input: { guildId: string }
): Promise<Result<StructureBackupSettingsRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const settings = await db.client.query(api.structure.findStructureBackupSettingsByGuildId, {
            guildId: guildId.value,
        });

        return ok(toBackupSettingsRecord(settings));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertStructureBackupSettings(
    db: StructureDb,
    input: {
        cadenceWeeks: number;
        enabled: boolean;
        guildId: string;
        retentionDays?: number;
        audit?: StructureAuditInput;
    }
): Promise<Result<StructureBackupSettingsRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const cadenceWeeks = normalizeCadenceWeeks(input.cadenceWeeks);
    const retentionDays = normalizeRetentionDays(input.retentionDays);

    if (guildId.isErr()) return err(guildId.error);
    if (cadenceWeeks.isErr()) return err(cadenceWeeks.error);
    if (retentionDays.isErr()) return err(retentionDays.error);

    try {
        const settings = await db.client.mutation(
            api.structure.upsertStructureBackupSettings,
            compactConvexArgs({
                audit: normalizeStructureAuditInput(input.audit),
                cadenceWeeks: cadenceWeeks.value,
                enabled: input.enabled,
                guildId: guildId.value,
                retentionDays: retentionDays.value,
            })
        );

        return ok(toBackupSettingsRecord(settings));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listDueStructureBackupRetentionSettings(
    db: StructureDb,
    input: { limit?: number; now: Date }
): Promise<Result<StructureBackupSettingsRecord[], StructureImportExportRepositoryError>> {
    const limit = normalizeLimit(input.limit);
    if (limit.isErr()) return err(limit.error);

    try {
        const settings = await db.client.query(api.structure.listDueStructureBackupRetentionSettings, {
            limit: limit.value,
            now: input.now.toISOString(),
        });

        return ok(settings.map(toBackupSettingsRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function pruneExpiredStructureBackupsForGuild(
    db: StructureDb,
    input: { audit?: StructureAuditInput; guildId: string; limit?: number; now: Date }
): Promise<Result<StructureBackupRetentionPruneRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit, 100);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const result = await db.client.mutation(
            api.structure.pruneExpiredStructureBackupsForGuild,
            compactConvexArgs({
                audit: normalizeStructureAuditInput(input.audit),
                guildId: guildId.value,
                limit: limit.value,
                now: input.now.toISOString(),
            })
        );

        return ok(toBackupRetentionPruneRecord(result));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listDueStructureBackupSettings(
    db: StructureDb,
    input: { limit?: number; now: Date }
): Promise<Result<StructureBackupSettingsRecord[], StructureImportExportRepositoryError>> {
    const limit = normalizeLimit(input.limit);
    if (limit.isErr()) return err(limit.error);

    try {
        const settings = await db.client.query(api.structure.listDueStructureBackupSettings, {
            limit: limit.value,
            now: input.now.toISOString(),
        });

        return ok(settings.map(toBackupSettingsRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listDueStructureDriftSettings(
    db: StructureDb,
    input: { limit?: number; now: Date }
): Promise<Result<StructureBackupSettingsRecord[], StructureImportExportRepositoryError>> {
    const limit = normalizeLimit(input.limit);
    if (limit.isErr()) return err(limit.error);

    try {
        const settings = await db.client.query(api.structure.listDueStructureDriftSettings, {
            limit: limit.value,
            now: input.now.toISOString(),
        });

        return ok(settings.map(toBackupSettingsRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function claimDueStructureBackupSetting(
    db: StructureDb,
    input: { guildId: string; leaseExpiresAt: Date; leaseId: string; leaseOwner: string; now: Date }
): Promise<Result<StructureBackupSettingsRecord | null, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const leaseId = normalizeRequiredText(input.leaseId, 'leaseId');
    const leaseOwner = normalizeRequiredText(input.leaseOwner, 'leaseOwner');

    if (guildId.isErr()) return err(guildId.error);
    if (leaseId.isErr()) return err(leaseId.error);
    if (leaseOwner.isErr()) return err(leaseOwner.error);

    try {
        const settings = await db.client.mutation(api.structure.claimDueStructureBackupSetting, {
            guildId: guildId.value,
            leaseExpiresAt: input.leaseExpiresAt.toISOString(),
            leaseId: leaseId.value,
            leaseOwner: leaseOwner.value,
            now: input.now.toISOString(),
        });

        return ok(settings ? toBackupSettingsRecord(settings) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function claimDueStructureDriftSetting(
    db: StructureDb,
    input: { guildId: string; leaseExpiresAt: Date; leaseId: string; leaseOwner: string; now: Date }
): Promise<Result<StructureBackupSettingsRecord | null, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const leaseId = normalizeRequiredText(input.leaseId, 'leaseId');
    const leaseOwner = normalizeRequiredText(input.leaseOwner, 'leaseOwner');

    if (guildId.isErr()) return err(guildId.error);
    if (leaseId.isErr()) return err(leaseId.error);
    if (leaseOwner.isErr()) return err(leaseOwner.error);

    try {
        const settings = await db.client.mutation(api.structure.claimDueStructureDriftSetting, {
            guildId: guildId.value,
            leaseExpiresAt: input.leaseExpiresAt.toISOString(),
            leaseId: leaseId.value,
            leaseOwner: leaseOwner.value,
            now: input.now.toISOString(),
        });

        return ok(settings ? toBackupSettingsRecord(settings) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function clearStructureBackupSettingLease(
    db: StructureDb,
    input: { guildId: string; leaseId: string; now: Date }
): Promise<Result<boolean, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const leaseId = normalizeRequiredText(input.leaseId, 'leaseId');

    if (guildId.isErr()) return err(guildId.error);
    if (leaseId.isErr()) return err(leaseId.error);

    try {
        const cleared = await db.client.mutation(api.structure.clearStructureBackupSettingLease, {
            guildId: guildId.value,
            leaseId: leaseId.value,
            now: input.now.toISOString(),
        });

        return ok(cleared);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function clearStructureDriftSettingLease(
    db: StructureDb,
    input: { guildId: string; leaseId: string; now: Date }
): Promise<Result<boolean, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const leaseId = normalizeRequiredText(input.leaseId, 'leaseId');

    if (guildId.isErr()) return err(guildId.error);
    if (leaseId.isErr()) return err(leaseId.error);

    try {
        const cleared = await db.client.mutation(api.structure.clearStructureDriftSettingLease, {
            guildId: guildId.value,
            leaseId: leaseId.value,
            now: input.now.toISOString(),
        });

        return ok(cleared);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordStructureScheduledDriftResult(
    db: StructureDb,
    input: {
        audit?: StructureAuditInput;
        baselineBackupId?: string;
        baselineName?: string;
        changeCount?: number;
        errorMessage?: string;
        fieldSummary?: Record<string, unknown>;
        guildId: string;
        hasMorePreview?: boolean;
        liveCounts?: Record<string, unknown>;
        now: Date;
        status: string;
        summary?: Record<string, unknown>;
    }
): Promise<Result<StructureBackupSettingsRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const status = normalizeRequiredText(input.status, 'status');

    if (guildId.isErr()) return err(guildId.error);
    if (status.isErr()) return err(status.error);

    try {
        const settings = await db.client.mutation(
            api.structure.recordStructureScheduledDriftResult,
            compactConvexArgs({
                audit: normalizeStructureAuditInput(input.audit),
                baselineBackupId: normalizeOptionalText(input.baselineBackupId),
                baselineName: normalizeOptionalText(input.baselineName),
                changeCount: input.changeCount,
                errorMessage: normalizeOptionalText(input.errorMessage),
                fieldSummary: input.fieldSummary,
                guildId: guildId.value,
                hasMorePreview: input.hasMorePreview,
                liveCounts: input.liveCounts,
                now: input.now.toISOString(),
                status: status.value,
                summary: input.summary,
            })
        );

        return ok(toBackupSettingsRecord(settings));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createStructureImportRun(
    db: StructureDb,
    input: {
        createdByUserId?: string;
        deleteActionCount: number;
        deleteSetDigest?: string;
        guildId: string;
        plan?: Record<string, unknown>;
        planDigest: string;
        planVersion: 2;
        policy: 'merge' | 'synchronize' | 'rebuild';
        requestedSnapshotDigest: string;
        sourceBackupId?: string;
    }
): Promise<Result<StructureImportRunRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const deleteSetDigest = normalizeOptionalText(input.deleteSetDigest);
    const planDigest = normalizeRequiredText(input.planDigest, 'planDigest');
    const requestedSnapshotDigest = normalizeRequiredText(input.requestedSnapshotDigest, 'requestedSnapshotDigest');
    if (guildId.isErr()) return err(guildId.error);
    if (!Number.isInteger(input.deleteActionCount) || input.deleteActionCount < 0)
        return err({ field: 'deleteActionCount', type: 'invalid-value' });
    if (input.deleteActionCount > 0 && !deleteSetDigest)
        return err({ field: 'deleteSetDigest', type: 'missing-input' });
    if (input.deleteActionCount === 0 && deleteSetDigest)
        return err({ field: 'deleteSetDigest', type: 'invalid-value' });
    if (planDigest.isErr()) return err(planDigest.error);
    if (requestedSnapshotDigest.isErr()) return err(requestedSnapshotDigest.error);

    try {
        const run = await db.client.mutation(
            api.structure.createStructureImportRun,
            compactConvexArgs({
                createdByUserId: normalizeOptionalText(input.createdByUserId),
                deleteActionCount: input.deleteActionCount,
                deleteSetDigest,
                guildId: guildId.value,
                plan: input.plan ?? {},
                planDigest: planDigest.value,
                planVersion: input.planVersion,
                policy: input.policy,
                requestedSnapshotDigest: requestedSnapshotDigest.value,
                sourceBackupId: normalizeOptionalText(input.sourceBackupId),
            })
        );

        return ok(toImportRunRecord(run));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStructureImportRunsByGuildId(
    db: StructureDb,
    input: { guildId: string; limit?: number }
): Promise<Result<StructureImportRunRecord[], StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const runs = await db.client.query(api.structure.listStructureImportRunsByGuildId, {
            guildId: guildId.value,
            limit: limit.value,
        });

        return ok(runs.map(toImportRunRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findStructureImportRunByGuildId(
    db: StructureDb,
    input: { guildId: string; runId: string }
): Promise<Result<StructureImportRunRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const runId = normalizeRequiredText(input.runId, 'runId');

    if (guildId.isErr()) return err(guildId.error);
    if (runId.isErr()) return err(runId.error);

    try {
        const run = await db.client.query(api.structure.findStructureImportRunByGuildId, {
            guildId: guildId.value,
            runId: runId.value,
        });

        return run ? ok(toImportRunRecord(run)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findStructureImportRunWithActionsByGuildId(
    db: StructureDb,
    input: { guildId: string; runId: string }
): Promise<Result<StructureImportRunWithActionsRecord, StructureImportExportRepositoryError>> {
    const run = await findStructureImportRunByGuildId(db, input);
    if (run.isErr()) return err(run.error);

    const actions = await listAllStructureImportActionsByRunId(db, { runId: run.value.id });
    if (actions.isErr()) return err(actions.error);

    return ok({ ...run.value, actions: actions.value });
}

export async function listStructureImportActionsByRunIdPage(
    db: StructureDb,
    input: { cursor?: string; limit?: number; runId: string }
): Promise<Result<StructureImportActionPageRecord, StructureImportExportRepositoryError>> {
    const runId = normalizeRequiredText(input.runId, 'runId');
    const limit = normalizeLimit(input.limit, importActionPageSize);

    if (runId.isErr()) return err(runId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const page = await db.client.query(
            api.structure.listStructureImportActionsByRunIdPage,
            compactConvexArgs({
                cursor: normalizeOptionalText(input.cursor),
                limit: limit.value,
                runId: runId.value,
            })
        );

        return ok(toImportActionPageRecord(page));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listAllStructureImportActionsByRunId(
    db: StructureDb,
    input: { runId: string }
): Promise<Result<StructureImportActionRecord[], StructureImportExportRepositoryError>> {
    const actions: StructureImportActionRecord[] = [];
    let cursor: string | undefined;

    do {
        const page = await listStructureImportActionsByRunIdPage(db, {
            ...(cursor ? { cursor } : {}),
            limit: importActionPageSize,
            runId: input.runId,
        });

        if (page.isErr()) return err(page.error);

        actions.push(...page.value.actions);
        cursor = page.value.nextCursor ?? undefined;
    } while (cursor);

    return ok(actions);
}

export async function recordStructureImportAction(
    db: StructureDb,
    input: {
        actionType: string;
        details?: Record<string, unknown>;
        runId: string;
        sequence: number;
        targetId?: string;
        targetType: string;
    }
): Promise<Result<StructureImportActionRecord, StructureImportExportRepositoryError>> {
    const normalizedInput = normalizeImportActionInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const action = await db.client.mutation(api.structure.recordStructureImportAction, normalizedInput.value);

        return ok(toImportActionRecord(action));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordStructureImportActionsBatch(
    db: StructureDb,
    input: {
        actions: Array<{
            actionType: string;
            details?: Record<string, unknown>;
            sequence: number;
            targetId?: string;
            targetType: string;
        }>;
        runId: string;
    }
): Promise<Result<StructureImportActionRecord[], StructureImportExportRepositoryError>> {
    const runId = normalizeRequiredText(input.runId, 'runId');
    if (runId.isErr()) return err(runId.error);
    if (input.actions.length < 1 || input.actions.length > 100) {
        return err({ field: 'actions', type: 'invalid-value' });
    }
    if (new Set(input.actions.map((action) => action.sequence)).size !== input.actions.length) {
        return err({ field: 'sequence', type: 'invalid-value' });
    }

    const actions = [];
    for (const action of input.actions) {
        const normalized = normalizeImportActionInput({ ...action, runId: runId.value });
        if (normalized.isErr()) return err(normalized.error);
        actions.push({
            actionType: normalized.value.actionType,
            details: normalized.value.details,
            sequence: normalized.value.sequence,
            ...(normalized.value.targetId ? { targetId: normalized.value.targetId } : {}),
            targetType: normalized.value.targetType,
        });
    }

    try {
        const records = await db.client.mutation(api.structure.recordStructureImportActionsBatch, {
            actions,
            runId: runId.value,
        });

        return ok(records.map(toImportActionRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeObservedEventInput(input: {
    eventType: string;
    guildId: string;
    targetId?: string;
    targetType: string;
}) {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const eventType = normalizeRequiredText(input.eventType, 'eventType');
    const targetType = normalizeRequiredText(input.targetType, 'targetType');
    const targetId = normalizeOptionalText(input.targetId);

    if (guildId.isErr()) return err(guildId.error);
    if (eventType.isErr()) return err(eventType.error);
    if (targetType.isErr()) return err(targetType.error);

    return ok({
        eventType: eventType.value,
        guildId: guildId.value,
        ...(targetId ? { targetId } : {}),
        targetType: targetType.value,
    });
}

function normalizeImportActionInput(input: {
    actionType: string;
    details?: Record<string, unknown>;
    runId: string;
    sequence?: number;
    targetId?: string;
    targetType: string;
}) {
    const runId = normalizeRequiredText(input.runId, 'runId');
    const actionType = normalizeRequiredText(input.actionType, 'actionType');
    const targetType = normalizeRequiredText(input.targetType, 'targetType');
    const targetId = normalizeOptionalText(input.targetId);
    const sequence = input.sequence;

    if (runId.isErr()) return err(runId.error);
    if (actionType.isErr()) return err(actionType.error);
    if (targetType.isErr()) return err(targetType.error);
    if (!Number.isInteger(sequence) || typeof sequence !== 'number' || sequence < 0) {
        return err({ field: 'sequence', type: 'invalid-value' as const });
    }

    return ok({
        actionType: actionType.value,
        details: input.details ?? {},
        runId: runId.value,
        sequence,
        ...(targetId ? { targetId } : {}),
        targetType: targetType.value,
    });
}

function normalizeStructureAuditInput(input: StructureAuditInput | undefined):
    | {
          action: string;
          actorUserId?: string;
          metadata?: Record<string, unknown>;
          targetId?: string;
      }
    | undefined {
    if (!input) return undefined;

    const action = normalizeRequiredText(input.action, 'action');
    if (action.isErr()) return undefined;

    return compactConvexArgs({
        action: action.value,
        actorUserId: normalizeOptionalText(input.actorUserId),
        metadata: input.metadata,
        targetId: normalizeOptionalText(input.targetId),
    });
}
