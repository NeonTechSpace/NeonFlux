import { api } from '@neonflux/convex-api';
import type { Id } from '@neonflux/convex-api/data-model';
import { normalizeBlueprintPlanStep } from '@neonflux/blueprint/runtime-contracts';
import type {
    StructureBackupRecord,
    StructureBackupRetentionPruneRecord,
    StructureBackupSettingsRecord,
    StructureBackupSummaryPageRecord,
    StructureBackupSummaryRecord,
    BlueprintPlanStepPageRecord,
    BlueprintPlanStepRecord,
    BlueprintPlanAuthorityRecord,
    BlueprintPlanExecutionAuthorityRecord,
    BlueprintPlanMetadataRecord,
    BlueprintRepositoryError,
    BlueprintPlanSummaryRecord,
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
    toObservedEventStateRecord,
} from './runtime-blueprint-records.js';
import { toBlueprintPlanAuthority, toBlueprintPlanMetadata } from './runtime-blueprint-run-records.js';

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

export async function createBlueprintPlanDraft(
    db: BlueprintDb,
    input: Omit<
        BlueprintPlanMetadataRecord,
        'createdAt' | 'createdByUserId' | 'deleteSetDigest' | 'id' | 'sourceBackupId' | 'status' | 'updatedAt'
    > & {
        authority: Omit<BlueprintPlanAuthorityRecord, 'createdAt' | 'guildId' | 'id' | 'planId'>;
        creationRequestKey: string;
        createdByUserId?: string;
        deleteSetDigest?: string;
        executionAuthority: Omit<BlueprintPlanExecutionAuthorityRecord, 'createdAt' | 'guildId' | 'id' | 'planId'>;
        now: Date;
        sourceBackupId?: string;
    }
): Promise<Result<BlueprintPlanMetadataRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const deleteSetDigest = normalizeOptionalText(input.deleteSetDigest);
    const planDigest = normalizeRequiredText(input.planDigest, 'planDigest');
    const requestedSnapshotDigest = normalizeRequiredText(input.requestedSnapshotDigest, 'requestedSnapshotDigest');
    const projectedSnapshotDigest = normalizeRequiredText(input.projectedSnapshotDigest, 'projectedSnapshotDigest');
    const authorityDigest = normalizeRequiredText(input.authorityDigest, 'authorityDigest');
    const executionAuthorityDigest = normalizeRequiredText(input.executionAuthorityDigest, 'executionAuthorityDigest');
    const stepLedgerDigest = normalizeRequiredText(input.stepLedgerDigest, 'stepLedgerDigest');
    const decisionLedgerDigest = normalizeRequiredText(input.decisionLedgerDigest, 'decisionLedgerDigest');
    if (guildId.isErr()) return err(guildId.error);
    for (const [field, value] of [
        ['blockerCount', input.blockerCount],
        ['stepCount', input.stepCount],
        ['decisionCount', input.decisionCount],
        ['deleteStepCount', input.deleteStepCount],
    ] as const) {
        if (!Number.isSafeInteger(value) || value < 0) return err({ field, type: 'invalid-value' });
    }
    if (input.deleteStepCount > 0 && !deleteSetDigest) return err({ field: 'deleteSetDigest', type: 'missing-input' });
    if (input.deleteStepCount === 0 && deleteSetDigest) return err({ field: 'deleteSetDigest', type: 'invalid-value' });
    if (planDigest.isErr()) return err(planDigest.error);
    if (requestedSnapshotDigest.isErr()) return err(requestedSnapshotDigest.error);
    if (projectedSnapshotDigest.isErr()) return err(projectedSnapshotDigest.error);
    if (authorityDigest.isErr()) return err(authorityDigest.error);
    if (executionAuthorityDigest.isErr()) return err(executionAuthorityDigest.error);
    if (stepLedgerDigest.isErr()) return err(stepLedgerDigest.error);
    if (decisionLedgerDigest.isErr()) return err(decisionLedgerDigest.error);

    try {
        const plan = await db.client.mutation(
            api.blueprint.createBlueprintPlanDraft,
            compactConvexArgs({
                metadata: compactConvexArgs({
                    authorityDigest: authorityDigest.value,
                    authorityVersion: input.authorityVersion,
                    blockerCount: input.blockerCount,
                    createdByUserId: normalizeOptionalText(input.createdByUserId ?? undefined),
                    decisionCount: input.decisionCount,
                    decisionLedgerDigest: decisionLedgerDigest.value,
                    decisionSummary: input.decisionSummary,
                    deleteSetDigest,
                    deleteStepCount: input.deleteStepCount,
                    executionAuthorityDigest: executionAuthorityDigest.value,
                    executionAuthorityVersion: input.executionAuthorityVersion,
                    guildId: guildId.value,
                    planDigest: planDigest.value,
                    planVersion: input.planVersion,
                    policy: input.policy,
                    projectedSnapshotDigest: projectedSnapshotDigest.value,
                    requestedSnapshotDigest: requestedSnapshotDigest.value,
                    sourceBackupId: normalizeOptionalText(input.sourceBackupId ?? undefined),
                    stepCount: input.stepCount,
                    stepLedgerDigest: stepLedgerDigest.value,
                    summary: input.summary,
                }),
                authority: {
                    ...input.authority,
                    authorityDigest: authorityDigest.value,
                    guildId: guildId.value,
                },
                creationRequestKey: input.creationRequestKey,
                executionAuthority: {
                    ...input.executionAuthority,
                    executionAuthorityDigest: executionAuthorityDigest.value,
                    guildId: guildId.value,
                },
                now: input.now.toISOString(),
            })
        );

        return ok(toBlueprintPlanMetadata(plan));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listBlueprintPlanSummariesByGuildId(
    db: BlueprintDb,
    input: { guildId: string; limit?: number }
): Promise<Result<BlueprintPlanSummaryRecord[], BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const plans = await db.client.query(api.blueprint.listBlueprintPlanSummariesByGuildId, {
            guildId: guildId.value,
            limit: limit.value,
        });

        return ok(plans.map(toBlueprintPlanMetadata));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function getBlueprintPlanMetadata(
    db: BlueprintDb,
    input: { guildId: string; planId: string }
): Promise<Result<BlueprintPlanMetadataRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const planId = normalizeRequiredText(input.planId, 'planId');

    if (guildId.isErr()) return err(guildId.error);
    if (planId.isErr()) return err(planId.error);

    try {
        const plan = await db.client.query(api.blueprint.getBlueprintPlanMetadata, {
            guildId: guildId.value,
            planId: planId.value as Id<'blueprintPlans'>,
        });

        return plan ? ok(toBlueprintPlanMetadata(plan)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function getBlueprintPlanAuthority(
    db: BlueprintDb,
    input: { guildId: string; planId: string }
): Promise<Result<BlueprintPlanAuthorityRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const planId = normalizeRequiredText(input.planId, 'planId');

    if (guildId.isErr()) return err(guildId.error);
    if (planId.isErr()) return err(planId.error);

    try {
        const authority = await db.client.query(api.blueprint.getBlueprintPlanAuthority, {
            guildId: guildId.value,
            planId: planId.value as Id<'blueprintPlans'>,
        });

        return authority ? ok(toBlueprintPlanAuthority(authority)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listBlueprintPlanStepsByPlanIdPage(
    db: BlueprintDb,
    input: { cursor?: string; guildId: string; limit?: number; planId: string }
): Promise<Result<BlueprintPlanStepPageRecord, BlueprintRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const planId = normalizeRequiredText(input.planId, 'planId');
    const limit = normalizeLimit(input.limit, blueprintPlanStepPageSize);

    if (guildId.isErr()) return err(guildId.error);
    if (planId.isErr()) return err(planId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const page = await db.client.query(
            api.blueprint.listBlueprintPlanStepsByPlanIdPage,
            compactConvexArgs({
                cursor: normalizeOptionalText(input.cursor),
                guildId: guildId.value,
                limit: limit.value,
                planId: planId.value as Id<'blueprintPlans'>,
            })
        );

        return ok(toBlueprintPlanStepPageRecord(page));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listAllBlueprintPlanStepsByPlanId(
    db: BlueprintDb,
    input: { guildId: string; planId: string }
): Promise<Result<BlueprintPlanStepRecord[], BlueprintRepositoryError>> {
    const steps: BlueprintPlanStepRecord[] = [];
    let cursor: string | undefined;

    do {
        const page = await listBlueprintPlanStepsByPlanIdPage(db, {
            ...(cursor ? { cursor } : {}),
            guildId: input.guildId,
            limit: blueprintPlanStepPageSize,
            planId: input.planId,
        });

        if (page.isErr()) return err(page.error);

        steps.push(...page.value.steps);
        cursor = page.value.nextCursor ?? undefined;
    } while (cursor);

    return ok(steps);
}

export async function writeBlueprintPlanStepBatch(
    db: BlueprintDb,
    input: {
        steps: Array<{
            sequence: number;
            step: BlueprintPlanStepRecord['step'];
        }>;
        now: Date;
        planId: string;
    }
): Promise<Result<BlueprintPlanStepRecord[], BlueprintRepositoryError>> {
    const planId = normalizeRequiredText(input.planId, 'planId');
    if (planId.isErr()) return err(planId.error);
    if (input.steps.length < 1 || input.steps.length > 100) {
        return err({ field: 'steps', type: 'invalid-value' });
    }
    if (!hasContiguousSequences(input.steps)) {
        return err({ field: 'sequence', type: 'invalid-value' });
    }

    const steps = [];
    for (const entry of input.steps) {
        const normalized = normalizeBlueprintPlanStep(entry.step);
        if (normalized.type === 'invalid') return err({ field: 'step', type: 'invalid-value' });
        steps.push({ sequence: entry.sequence, step: normalized.value });
    }

    try {
        const records = await db.client.mutation(api.blueprint.writeBlueprintPlanStepBatch, {
            steps,
            now: input.now.toISOString(),
            planId: planId.value as Id<'blueprintPlans'>,
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

function hasContiguousSequences(entries: ReadonlyArray<{ sequence: number }>): boolean {
    const firstSequence = entries[0]?.sequence;
    return (
        firstSequence !== undefined &&
        Number.isSafeInteger(firstSequence) &&
        firstSequence >= 0 &&
        entries.every((entry, index) => entry.sequence === firstSequence + index)
    );
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
