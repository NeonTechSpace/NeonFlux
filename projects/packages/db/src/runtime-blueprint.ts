import { api } from '@neonflux/convex-api';
import { normalizeBlueprintPlanStep } from '@neonflux/blueprint/runtime-contracts';
import type {
    StructureBackupRecord,
    StructureBackupRetentionPruneRecord,
    StructureBackupSettingsRecord,
    StructureBackupSummaryPageRecord,
    StructureBackupSummaryRecord,
    BlueprintPlanStepPageRecord,
    BlueprintPlanStepRecord,
    BlueprintRepositoryError,
    BlueprintPlanRecord,
    BlueprintPlanWithStepsRecord,
    StructureObservedEventStateRecord,
} from './contracts-blueprint.js';
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
    toBlueprintPlanStepPageRecord,
    toBlueprintPlanStepRecord,
    toBlueprintPlanRecord,
    toObservedEventStateRecord,
} from './runtime-blueprint-records.js';

type BlueprintDb = ConvexDatabase;
type BlueprintAuditInput = {
    action: string;
    actorUserId?: string;
    metadata?: Record<string, unknown>;
    targetId?: string;
};

const blueprintPlanStepPageSize = 100;

export async function findStructureObservedEventStateByGuildId(
    db: BlueprintDb,
    input: { guildId: string }
): Promise<Result<StructureObservedEventStateRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const state = await db.client.query(api.blueprint.findStructureObservedEventStateByGuildId, {
            guildId: guildId.value,
        });

        return ok(toObservedEventStateRecord(state));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordStructureObservedEvent(
    db: BlueprintDb,
    input: { eventType: string; guildId: string; targetId?: string; targetType: string }
): Promise<Result<StructureObservedEventStateRecord, BlueprintRepositoryError>> {
    const normalizedInput = normalizeObservedEventInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const state = await db.client.mutation(api.blueprint.recordStructureObservedEvent, normalizedInput.value);

        return ok(toObservedEventStateRecord(state));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createStructureBackup(
    db: BlueprintDb,
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
        audit?: BlueprintAuditInput;
    }
): Promise<Result<StructureBackupRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const backup = await db.client.mutation(
            api.blueprint.createStructureBackup,
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
                audit: normalizeBlueprintAuditInput(input.audit),
            })
        );

        return ok(toBackupRecord(backup));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStructureBackupsByGuildId(
    db: BlueprintDb,
    input: { guildId: string; limit?: number }
): Promise<Result<StructureBackupRecord[], BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const backups = await db.client.query(api.blueprint.listStructureBackupsByGuildId, {
            guildId: guildId.value,
            limit: limit.value,
        });

        return ok(backups.map(toBackupRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStructureBackupSummariesByGuildId(
    db: BlueprintDb,
    input: { guildId: string; limit?: number }
): Promise<Result<StructureBackupSummaryRecord[], BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const backups = await db.client.query(api.blueprint.listStructureBackupSummariesByGuildId, {
            guildId: guildId.value,
            limit: limit.value,
        });

        return ok(backups.map(toBackupSummaryRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStructureBackupSummaryPageByGuildId(
    db: BlueprintDb,
    input: { cursor?: string; guildId: string; limit?: number }
): Promise<Result<StructureBackupSummaryPageRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const page = await db.client.query(
            api.blueprint.listStructureBackupSummaryPageByGuildId,
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
    db: BlueprintDb,
    input: { backupId: string; guildId: string; name: string; audit?: BlueprintAuditInput }
): Promise<Result<StructureBackupSummaryRecord, BlueprintRepositoryError>> {
    const backupId = normalizeRequiredText(input.backupId, 'backupId');
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeBackupName(input.name);

    if (backupId.isErr()) return err(backupId.error);
    if (guildId.isErr()) return err(guildId.error);
    if (name.isErr()) return err(name.error);

    try {
        const backup = await db.client.mutation(
            api.blueprint.renameStructureBackup,
            compactConvexArgs({
                audit: normalizeBlueprintAuditInput(input.audit),
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
    db: BlueprintDb,
    input: { backupId: string; guildId: string; audit?: BlueprintAuditInput }
): Promise<Result<boolean, BlueprintRepositoryError>> {
    const backupId = normalizeRequiredText(input.backupId, 'backupId');
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (backupId.isErr()) return err(backupId.error);
    if (guildId.isErr()) return err(guildId.error);

    try {
        const deleted = await db.client.mutation(
            api.blueprint.deleteStructureBackup,
            compactConvexArgs({
                audit: normalizeBlueprintAuditInput(input.audit),
                backupId: backupId.value,
                guildId: guildId.value,
            })
        );

        return deleted ? ok(true) : err({ type: 'not-found' });
    } catch (error) {
        return err(mapStructureBackupDeleteError(error));
    }
}

function mapStructureBackupDeleteError(error: unknown): BlueprintRepositoryError {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('blueprint-restore-point-recovery-window-active')) {
        return { type: 'blueprint-restore-point-recovery-window-active' };
    }
    if (message.includes('blueprint-restore-point-run-active')) {
        return { type: 'blueprint-restore-point-run-active' };
    }
    return { type: 'database-error' };
}

export async function findStructureBackupByGuildId(
    db: BlueprintDb,
    input: { backupId: string; guildId: string }
): Promise<Result<StructureBackupRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const backupId = normalizeRequiredText(input.backupId, 'backupId');

    if (guildId.isErr()) return err(guildId.error);
    if (backupId.isErr()) return err(backupId.error);

    try {
        const backup = await db.client.query(api.blueprint.findStructureBackupByGuildId, {
            backupId: backupId.value,
            guildId: guildId.value,
        });

        return backup ? ok(toBackupRecord(backup)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findLatestStructureDriftBaselineBackupByGuildId(
    db: BlueprintDb,
    input: { guildId: string }
): Promise<Result<StructureBackupRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const backup = await db.client.query(api.blueprint.findLatestStructureDriftBaselineBackupByGuildId, {
            guildId: guildId.value,
        });

        return backup ? ok(toBackupRecord(backup)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findStructureBackupSettingsByGuildId(
    db: BlueprintDb,
    input: { guildId: string }
): Promise<Result<StructureBackupSettingsRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const settings = await db.client.query(api.blueprint.findStructureBackupSettingsByGuildId, {
            guildId: guildId.value,
        });

        return ok(toBackupSettingsRecord(settings));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertStructureBackupSettings(
    db: BlueprintDb,
    input: {
        cadenceWeeks: number;
        enabled: boolean;
        guildId: string;
        retentionDays?: number;
        audit?: BlueprintAuditInput;
    }
): Promise<Result<StructureBackupSettingsRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const cadenceWeeks = normalizeCadenceWeeks(input.cadenceWeeks);
    const retentionDays = normalizeRetentionDays(input.retentionDays);

    if (guildId.isErr()) return err(guildId.error);
    if (cadenceWeeks.isErr()) return err(cadenceWeeks.error);
    if (retentionDays.isErr()) return err(retentionDays.error);

    try {
        const settings = await db.client.mutation(
            api.blueprint.upsertStructureBackupSettings,
            compactConvexArgs({
                audit: normalizeBlueprintAuditInput(input.audit),
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
    db: BlueprintDb,
    input: { limit?: number; now: Date }
): Promise<Result<StructureBackupSettingsRecord[], BlueprintRepositoryError>> {
    const limit = normalizeLimit(input.limit);
    if (limit.isErr()) return err(limit.error);

    try {
        const settings = await db.client.query(api.blueprint.listDueStructureBackupRetentionSettings, {
            limit: limit.value,
            now: input.now.toISOString(),
        });

        return ok(settings.map(toBackupSettingsRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function pruneExpiredStructureBackupsForGuild(
    db: BlueprintDb,
    input: { audit?: BlueprintAuditInput; guildId: string; limit?: number; now: Date }
): Promise<Result<StructureBackupRetentionPruneRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit, 100);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const result = await db.client.mutation(
            api.blueprint.pruneExpiredStructureBackupsForGuild,
            compactConvexArgs({
                audit: normalizeBlueprintAuditInput(input.audit),
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
    db: BlueprintDb,
    input: { limit?: number; now: Date }
): Promise<Result<StructureBackupSettingsRecord[], BlueprintRepositoryError>> {
    const limit = normalizeLimit(input.limit);
    if (limit.isErr()) return err(limit.error);

    try {
        const settings = await db.client.query(api.blueprint.listDueStructureBackupSettings, {
            limit: limit.value,
            now: input.now.toISOString(),
        });

        return ok(settings.map(toBackupSettingsRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listDueStructureDriftSettings(
    db: BlueprintDb,
    input: { limit?: number; now: Date }
): Promise<Result<StructureBackupSettingsRecord[], BlueprintRepositoryError>> {
    const limit = normalizeLimit(input.limit);
    if (limit.isErr()) return err(limit.error);

    try {
        const settings = await db.client.query(api.blueprint.listDueStructureDriftSettings, {
            limit: limit.value,
            now: input.now.toISOString(),
        });

        return ok(settings.map(toBackupSettingsRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function claimDueStructureBackupSetting(
    db: BlueprintDb,
    input: { guildId: string; leaseExpiresAt: Date; leaseId: string; leaseOwner: string; now: Date }
): Promise<Result<StructureBackupSettingsRecord | null, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const leaseId = normalizeRequiredText(input.leaseId, 'leaseId');
    const leaseOwner = normalizeRequiredText(input.leaseOwner, 'leaseOwner');

    if (guildId.isErr()) return err(guildId.error);
    if (leaseId.isErr()) return err(leaseId.error);
    if (leaseOwner.isErr()) return err(leaseOwner.error);

    try {
        const settings = await db.client.mutation(api.blueprint.claimDueStructureBackupSetting, {
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
    db: BlueprintDb,
    input: { guildId: string; leaseExpiresAt: Date; leaseId: string; leaseOwner: string; now: Date }
): Promise<Result<StructureBackupSettingsRecord | null, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const leaseId = normalizeRequiredText(input.leaseId, 'leaseId');
    const leaseOwner = normalizeRequiredText(input.leaseOwner, 'leaseOwner');

    if (guildId.isErr()) return err(guildId.error);
    if (leaseId.isErr()) return err(leaseId.error);
    if (leaseOwner.isErr()) return err(leaseOwner.error);

    try {
        const settings = await db.client.mutation(api.blueprint.claimDueStructureDriftSetting, {
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
    db: BlueprintDb,
    input: { guildId: string; leaseId: string; now: Date }
): Promise<Result<boolean, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const leaseId = normalizeRequiredText(input.leaseId, 'leaseId');

    if (guildId.isErr()) return err(guildId.error);
    if (leaseId.isErr()) return err(leaseId.error);

    try {
        const cleared = await db.client.mutation(api.blueprint.clearStructureBackupSettingLease, {
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
    db: BlueprintDb,
    input: { guildId: string; leaseId: string; now: Date }
): Promise<Result<boolean, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const leaseId = normalizeRequiredText(input.leaseId, 'leaseId');

    if (guildId.isErr()) return err(guildId.error);
    if (leaseId.isErr()) return err(leaseId.error);

    try {
        const cleared = await db.client.mutation(api.blueprint.clearStructureDriftSettingLease, {
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
    db: BlueprintDb,
    input: {
        audit?: BlueprintAuditInput;
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
): Promise<Result<StructureBackupSettingsRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const status = normalizeRequiredText(input.status, 'status');

    if (guildId.isErr()) return err(guildId.error);
    if (status.isErr()) return err(status.error);

    try {
        const settings = await db.client.mutation(
            api.blueprint.recordStructureScheduledDriftResult,
            compactConvexArgs({
                audit: normalizeBlueprintAuditInput(input.audit),
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

export async function createBlueprintPlan(
    db: BlueprintDb,
    input: {
        createdByUserId?: string;
        deleteStepCount: number;
        deleteSetDigest?: string;
        guildId: string;
        plan?: Record<string, unknown>;
        planDigest: string;
        planVersion: 3;
        policy: 'merge' | 'synchronize' | 'rebuild';
        requestedSnapshotDigest: string;
        sourceBackupId?: string;
    }
): Promise<Result<BlueprintPlanRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const deleteSetDigest = normalizeOptionalText(input.deleteSetDigest);
    const planDigest = normalizeRequiredText(input.planDigest, 'planDigest');
    const requestedSnapshotDigest = normalizeRequiredText(input.requestedSnapshotDigest, 'requestedSnapshotDigest');
    if (guildId.isErr()) return err(guildId.error);
    if (!Number.isInteger(input.deleteStepCount) || input.deleteStepCount < 0)
        return err({ field: 'deleteStepCount', type: 'invalid-value' });
    if (input.deleteStepCount > 0 && !deleteSetDigest) return err({ field: 'deleteSetDigest', type: 'missing-input' });
    if (input.deleteStepCount === 0 && deleteSetDigest) return err({ field: 'deleteSetDigest', type: 'invalid-value' });
    if (planDigest.isErr()) return err(planDigest.error);
    if (requestedSnapshotDigest.isErr()) return err(requestedSnapshotDigest.error);

    try {
        const plan = await db.client.mutation(
            api.blueprint.createBlueprintPlan,
            compactConvexArgs({
                createdByUserId: normalizeOptionalText(input.createdByUserId),
                deleteStepCount: input.deleteStepCount,
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

        return ok(toBlueprintPlanRecord(plan));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listBlueprintPlansByGuildId(
    db: BlueprintDb,
    input: { guildId: string; limit?: number }
): Promise<Result<BlueprintPlanRecord[], BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const plans = await db.client.query(api.blueprint.listBlueprintPlansByGuildId, {
            guildId: guildId.value,
            limit: limit.value,
        });

        return ok(plans.map(toBlueprintPlanRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findBlueprintPlanByGuildId(
    db: BlueprintDb,
    input: { guildId: string; planId: string }
): Promise<Result<BlueprintPlanRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const planId = normalizeRequiredText(input.planId, 'planId');

    if (guildId.isErr()) return err(guildId.error);
    if (planId.isErr()) return err(planId.error);

    try {
        const plan = await db.client.query(api.blueprint.findBlueprintPlanByGuildId, {
            guildId: guildId.value,
            planId: planId.value,
        });

        return plan ? ok(toBlueprintPlanRecord(plan)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findBlueprintPlanWithStepsByGuildId(
    db: BlueprintDb,
    input: { guildId: string; planId: string }
): Promise<Result<BlueprintPlanWithStepsRecord, BlueprintRepositoryError>> {
    const plan = await findBlueprintPlanByGuildId(db, input);
    if (plan.isErr()) return err(plan.error);

    const steps = await listAllBlueprintPlanStepsByPlanId(db, { planId: plan.value.id });
    if (steps.isErr()) return err(steps.error);

    return ok({ ...plan.value, steps: steps.value });
}

export async function listBlueprintPlanStepsByPlanIdPage(
    db: BlueprintDb,
    input: { cursor?: string; limit?: number; planId: string }
): Promise<Result<BlueprintPlanStepPageRecord, BlueprintRepositoryError>> {
    const planId = normalizeRequiredText(input.planId, 'planId');
    const limit = normalizeLimit(input.limit, blueprintPlanStepPageSize);

    if (planId.isErr()) return err(planId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const page = await db.client.query(
            api.blueprint.listBlueprintPlanStepsByPlanIdPage,
            compactConvexArgs({
                cursor: normalizeOptionalText(input.cursor),
                limit: limit.value,
                planId: planId.value,
            })
        );

        return ok(toBlueprintPlanStepPageRecord(page));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listAllBlueprintPlanStepsByPlanId(
    db: BlueprintDb,
    input: { planId: string }
): Promise<Result<BlueprintPlanStepRecord[], BlueprintRepositoryError>> {
    const steps: BlueprintPlanStepRecord[] = [];
    let cursor: string | undefined;

    do {
        const page = await listBlueprintPlanStepsByPlanIdPage(db, {
            ...(cursor ? { cursor } : {}),
            limit: blueprintPlanStepPageSize,
            planId: input.planId,
        });

        if (page.isErr()) return err(page.error);

        steps.push(...page.value.steps);
        cursor = page.value.nextCursor ?? undefined;
    } while (cursor);

    return ok(steps);
}

export async function recordBlueprintPlanStep(
    db: BlueprintDb,
    input: {
        actionType: string;
        details?: Record<string, unknown>;
        planId: string;
        sequence: number;
        targetId?: string;
        targetType: string;
    }
): Promise<Result<BlueprintPlanStepRecord, BlueprintRepositoryError>> {
    const normalizedInput = normalizeBlueprintPlanStepInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const step = await db.client.mutation(api.blueprint.recordBlueprintPlanStep, normalizedInput.value);

        return ok(toBlueprintPlanStepRecord(step));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordBlueprintPlanStepsBatch(
    db: BlueprintDb,
    input: {
        steps: Array<{
            actionType: string;
            details?: Record<string, unknown>;
            sequence: number;
            targetId?: string;
            targetType: string;
        }>;
        planId: string;
    }
): Promise<Result<BlueprintPlanStepRecord[], BlueprintRepositoryError>> {
    const planId = normalizeRequiredText(input.planId, 'planId');
    if (planId.isErr()) return err(planId.error);
    if (input.steps.length < 1 || input.steps.length > 100) {
        return err({ field: 'steps', type: 'invalid-value' });
    }
    if (new Set(input.steps.map((step) => step.sequence)).size !== input.steps.length) {
        return err({ field: 'sequence', type: 'invalid-value' });
    }

    const steps = [];
    for (const step of input.steps) {
        const normalized = normalizeBlueprintPlanStepInput({ ...step, planId: planId.value });
        if (normalized.isErr()) return err(normalized.error);
        steps.push({
            actionType: normalized.value.actionType,
            details: normalized.value.details,
            sequence: normalized.value.sequence,
            ...(normalized.value.targetId ? { targetId: normalized.value.targetId } : {}),
            targetType: normalized.value.targetType,
        });
    }

    try {
        const records = await db.client.mutation(api.blueprint.recordBlueprintPlanStepsBatch, {
            steps,
            planId: planId.value,
        });

        return ok(records.map(toBlueprintPlanStepRecord));
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

function normalizeBlueprintPlanStepInput(input: {
    actionType: string;
    details?: Record<string, unknown>;
    planId: string;
    sequence?: number;
    targetId?: string;
    targetType: string;
}) {
    const planId = normalizeRequiredText(input.planId, 'planId');
    const actionType = normalizeRequiredText(input.actionType, 'actionType');
    const targetType = normalizeRequiredText(input.targetType, 'targetType');
    const targetId = normalizeOptionalText(input.targetId);
    const sequence = input.sequence;

    if (planId.isErr()) return err(planId.error);
    if (actionType.isErr()) return err(actionType.error);
    if (targetType.isErr()) return err(targetType.error);
    if (!Number.isInteger(sequence) || typeof sequence !== 'number' || sequence < 0) {
        return err({ field: 'sequence', type: 'invalid-value' as const });
    }

    const details = input.details ?? {};
    const planStep = normalizeBlueprintPlanStep({
        actionType: actionType.value,
        targetType: targetType.value,
        ...(targetId ? { targetId } : {}),
        label: typeof details.label === 'string' ? details.label : '',
        details,
    });
    if (planStep.type === 'invalid') {
        return err({ field: 'details', type: 'invalid-value' as const });
    }

    return ok({
        actionType: actionType.value,
        details: planStep.value.details,
        planId: planId.value,
        sequence,
        ...(targetId ? { targetId } : {}),
        targetType: targetType.value,
    });
}

function normalizeBlueprintAuditInput(input: BlueprintAuditInput | undefined):
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
