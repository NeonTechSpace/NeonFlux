import '@tanstack/react-start/server-only';

import {
    createStructureBackup,
    deleteStructureBackup,
    findLatestStructureDriftBaselineBackupByGuildId,
    findStructureBackupByGuildId,
    findStructureBackupSettingsByGuildId,
    findStructureObservedEventStateByGuildId,
    listStructureBackupSummaryPageByGuildId,
    renameStructureBackup,
    blueprintAuditActions,
    structureBackupSources,
    structureBackupStatuses,
    upsertStructureBackupSettings,
} from '@neonflux/db';

import { readDashboardBotGuildStructure } from './bot-read-client.server.js';
import { getWebDb } from './db.server.js';
import { loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import type { AuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import { toDashboardBlueprintExportSnapshot, toDashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import type { DashboardBlueprintPlan } from './dashboard-blueprint-diff.js';
import type {
    DashboardBlueprintBackupDeleteInput,
    DashboardBlueprintBackupDeleteResult,
    DashboardBlueprintBackupJsonResult,
    DashboardBlueprintBackupPageInput,
    DashboardBlueprintBackupPageResult,
    DashboardBlueprintBackupRenameInput,
    DashboardBlueprintBackupRenameResult,
    DashboardBlueprintBackupResult,
    DashboardBlueprintBackupSettingsInput,
    DashboardBlueprintBackupSettingsResult,
    DashboardBlueprintBackupsResult,
    DashboardBlueprintCurrentExportResult,
    DashboardBlueprintDriftFieldSummary,
    DashboardBlueprintDriftInput,
    DashboardBlueprintDriftPreviewAction,
    DashboardBlueprintDriftResult,
} from './dashboard-blueprint-model.js';
import {
    createBlueprintAuditPayload,
    dashboardPlanStepInlineLimit,
    mapRepositoryError,
    toDashboardBackupPage,
    toDashboardBackupSettings,
    toDashboardBackupSummary,
    toDashboardObservedState,
    toJsonRecord,
} from './dashboard-blueprint-records.server.js';
import {
    mapBotStructureReadError,
    normalizeDashboardBlueprintPayload,
    tryDiffDashboardBlueprintSnapshot,
} from './dashboard-blueprint-snapshot-planning.server.js';

const dashboardBackupPageSize = 50;

export async function loadDashboardBlueprintBackups(
    request: Request,
    guildId: string
): Promise<DashboardBlueprintBackupsResult> {
    const context = await loadAuthorizedBlueprintContext(request, guildId);
    if (context.type !== 'authorized') return context;
    const database = await getWebDb();
    const [backupsResult, backupSettingsResult, observedStateResult] = await Promise.all([
        listStructureBackupSummaryPageByGuildId(database.db, {
            guildId: context.guild.id,
            limit: dashboardBackupPageSize,
        }),
        findStructureBackupSettingsByGuildId(database.db, { guildId: context.guild.id }),
        findStructureObservedEventStateByGuildId(database.db, { guildId: context.guild.id }),
    ]);
    if (backupsResult.isErr() || backupSettingsResult.isErr() || observedStateResult.isErr()) {
        return { type: 'database-error' };
    }
    return {
        type: 'backups',
        backups: backupsResult.value.backups.map(toDashboardBackupSummary),
        ...(backupsResult.value.nextCursor ? { backupNextCursor: backupsResult.value.nextCursor } : {}),
        backupSettings: toDashboardBackupSettings(backupSettingsResult.value),
        observedState: toDashboardObservedState(observedStateResult.value, backupSettingsResult.value),
    };
}

export async function readDashboardBlueprintBackupPage(
    request: Request,
    input: DashboardBlueprintBackupPageInput
): Promise<DashboardBlueprintBackupPageResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const database = await getWebDb();
    const pageResult = await listStructureBackupSummaryPageByGuildId(database.db, {
        cursor: input.cursor,
        guildId: context.guild.id,
        limit: input.limit ?? dashboardBackupPageSize,
    });
    return pageResult.isErr()
        ? mapRepositoryError(pageResult.error)
        : { type: 'backup-page', page: toDashboardBackupPage(pageResult.value) };
}

export async function exportDashboardBlueprint(
    request: Request,
    guildId: string
): Promise<DashboardBlueprintBackupResult> {
    const context = await loadAuthorizedBlueprintContext(request, guildId);
    return context.type === 'authorized'
        ? createDashboardBlueprintBackup(context, structureBackupSources.manual)
        : context;
}

export async function downloadDashboardBlueprintExport(
    request: Request,
    guildId: string
): Promise<DashboardBlueprintCurrentExportResult> {
    const context = await loadAuthorizedBlueprintContext(request, guildId);
    if (context.type !== 'authorized') return context;
    const structureResult = await readDashboardBotGuildStructure(context.guild.id);
    if (structureResult.isErr()) return mapBotStructureReadError(structureResult.error);
    const snapshot = toDashboardBlueprintExportSnapshot(structureResult.value);
    return {
        type: 'structure-export-created',
        fileName: createStructureExportFileName(context.guild.name, snapshot.exportedAt),
        structureJson: JSON.stringify(snapshot, null, 2),
    };
}

export async function readDashboardBlueprintBackupJson(
    request: Request,
    input: { backupId: string; guildId: string }
): Promise<DashboardBlueprintBackupJsonResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const backupId = input.backupId.trim();
    if (!backupId) return { type: 'not-found' };
    const database = await getWebDb();
    const backupResult = await findStructureBackupByGuildId(database.db, { backupId, guildId: context.guild.id });
    if (backupResult.isErr()) return mapRepositoryError(backupResult.error);
    if (!backupResult.value.structure) return { type: 'backup-json-unavailable' };
    return {
        type: 'backup-json',
        backupId: backupResult.value.id,
        fileName: createBackupDownloadFileName(backupResult.value.name),
        backupJson: JSON.stringify(backupResult.value.structure, null, 2),
    };
}

export async function readDashboardBlueprintDrift(
    request: Request,
    input: DashboardBlueprintDriftInput
): Promise<DashboardBlueprintDriftResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const database = await getWebDb();
    const backupResult = input.baselineBackupId?.trim()
        ? await findStructureBackupByGuildId(database.db, {
              backupId: input.baselineBackupId,
              guildId: context.guild.id,
          })
        : await findLatestStructureDriftBaselineBackupByGuildId(database.db, { guildId: context.guild.id });
    if (backupResult.isErr()) {
        return backupResult.error.type === 'not-found'
            ? { type: 'no-baseline' }
            : mapRepositoryError(backupResult.error);
    }
    if (backupResult.value.status !== structureBackupStatuses.succeeded || !backupResult.value.structure) {
        return input.baselineBackupId?.trim() ? { type: 'backup-json-unavailable' } : { type: 'no-baseline' };
    }
    const requestedResult = normalizeDashboardBlueprintPayload(backupResult.value.structure);
    if (requestedResult.type === 'invalid-input') return { type: 'backup-json-unavailable' };
    const currentResult = await readDashboardBotGuildStructure(context.guild.id);
    if (currentResult.isErr()) return mapBotStructureReadError(currentResult.error);
    const current = toDashboardBlueprintSnapshot(currentResult.value);
    const planResult = tryDiffDashboardBlueprintSnapshot(current, requestedResult.snapshot, { policy: 'synchronize' });
    if (planResult.type !== 'valid') return { type: 'backup-json-unavailable' };
    const plan = planResult.plan;
    return {
        type: 'structure-drift',
        baseline: toDashboardBackupSummary(backupResult.value),
        checkedAt: new Date().toISOString(),
        fieldSummary: summarizeDriftFields(plan),
        hasMorePreview: plan.steps.length > dashboardPlanStepInlineLimit,
        liveCounts: {
            categories: current.categories.length,
            channels: current.channels.length,
            roles: current.roles.length,
        },
        previewActions: plan.steps.slice(0, dashboardPlanStepInlineLimit).map(toDashboardDriftPreviewAction),
        summary: plan.summary,
    };
}

export async function renameDashboardBlueprintBackup(
    request: Request,
    input: DashboardBlueprintBackupRenameInput
): Promise<DashboardBlueprintBackupRenameResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const backupId = input.backupId.trim();
    const name = normalizeBackupDisplayName(input.name);
    if (!backupId) return { type: 'invalid-input', message: 'Choose a backup to rename.' };
    if (!name) return { type: 'invalid-input', message: 'Backup name is required.' };
    if (name.length > 120) return { type: 'invalid-input', message: 'Backup name must be 120 characters or fewer.' };
    const database = await getWebDb();
    const result = await renameStructureBackup(database.db, {
        audit: createBlueprintAuditPayload(context, blueprintAuditActions.backupRenamed, backupId, { name }),
        backupId,
        guildId: context.guild.id,
        name,
    });
    return result.isErr()
        ? mapRepositoryError(result.error)
        : { type: 'backup-renamed', backup: toDashboardBackupSummary(result.value) };
}

export async function deleteDashboardBlueprintBackup(
    request: Request,
    input: DashboardBlueprintBackupDeleteInput
): Promise<DashboardBlueprintBackupDeleteResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const backupId = input.backupId.trim();
    if (!backupId) return { type: 'invalid-input', message: 'Choose a backup to delete.' };
    const database = await getWebDb();
    const result = await deleteStructureBackup(database.db, {
        audit: createBlueprintAuditPayload(context, blueprintAuditActions.backupDeleted, backupId, {}),
        backupId,
        guildId: context.guild.id,
    });
    if (result.isErr()) {
        if (result.error.type === 'blueprint-restore-point-recovery-window-active') {
            return { type: 'restore-point-recovery-window-active' };
        }
        if (result.error.type === 'blueprint-restore-point-run-active') {
            return { type: 'restore-point-run-active' };
        }
        return mapRepositoryError(result.error);
    }
    return { type: 'backup-deleted', backupId };
}

export async function saveDashboardBlueprintBackupSettings(
    request: Request,
    input: DashboardBlueprintBackupSettingsInput
): Promise<DashboardBlueprintBackupSettingsResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    if (!Number.isInteger(input.cadenceWeeks) || input.cadenceWeeks < 1) {
        return { type: 'invalid-input', message: 'Automatic backups use a minimum cadence of 1 week.' };
    }
    if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 180) {
        return { type: 'invalid-input', message: 'Backup retention must be between 1 and 180 days.' };
    }
    const database = await getWebDb();
    const result = await upsertStructureBackupSettings(database.db, {
        audit: createBlueprintAuditPayload(context, blueprintAuditActions.backupSettingsUpdated, context.guild.id, {
            cadenceWeeks: input.cadenceWeeks,
            enabled: input.enabled,
            retentionDays: input.retentionDays,
        }),
        cadenceWeeks: input.cadenceWeeks,
        enabled: input.enabled,
        guildId: context.guild.id,
        retentionDays: input.retentionDays,
    });
    return result.isErr()
        ? mapRepositoryError(result.error)
        : { type: 'backup-settings-saved', backupSettings: toDashboardBackupSettings(result.value) };
}

async function createDashboardBlueprintBackup(
    context: AuthorizedBlueprintContext,
    source: string
): Promise<DashboardBlueprintBackupResult> {
    const structureResult = await readDashboardBotGuildStructure(context.guild.id);
    if (structureResult.isErr()) {
        const message =
            structureResult.error === 'not-configured'
                ? 'The bot read service is not configured.'
                : `Could not read server layout: ${structureResult.error}.`;
        const failedBackup = await recordFailedDashboardBlueprintBackup(context, source, message);
        if (failedBackup === 'database-error') return { type: 'database-error' };
        return mapBotStructureReadError(structureResult.error);
    }
    const snapshot = toDashboardBlueprintExportSnapshot(structureResult.value);
    const database = await getWebDb();
    const backupResult = await createStructureBackup(database.db, {
        audit: createBlueprintAuditPayload(context, blueprintAuditActions.backupCreated, undefined, {
            roleCount: snapshot.roles.length,
            categoryCount: snapshot.categories.length,
            channelCount: snapshot.channels.length,
            source,
        }),
        guildId: context.guild.id,
        createdByUserId: context.actor.actorUserId,
        serverName: context.guild.name,
        source,
        status: structureBackupStatuses.succeeded,
        structure: toJsonRecord(snapshot),
        roleCount: snapshot.roles.length,
        categoryCount: snapshot.categories.length,
        channelCount: snapshot.channels.length,
    });
    if (backupResult.isErr()) return { type: 'database-error' };
    return {
        type: 'backup-created',
        backup: toDashboardBackupSummary(backupResult.value),
        backupJson: JSON.stringify(snapshot, null, 2),
    };
}

async function recordFailedDashboardBlueprintBackup(
    context: AuthorizedBlueprintContext,
    source: string,
    errorMessage: string
): Promise<'database-error' | void> {
    const database = await getWebDb();
    const backupResult = await createStructureBackup(database.db, {
        audit: createBlueprintAuditPayload(context, blueprintAuditActions.backupFailed, undefined, {
            errorMessage,
            source,
        }),
        guildId: context.guild.id,
        createdByUserId: context.actor.actorUserId,
        serverName: context.guild.name,
        source,
        status: structureBackupStatuses.failed,
        errorMessage,
        roleCount: 0,
        categoryCount: 0,
        channelCount: 0,
    });
    if (backupResult.isErr()) return 'database-error';
}

function summarizeDriftFields(plan: DashboardBlueprintPlan): DashboardBlueprintDriftFieldSummary {
    const summary = { names: 0, parentMoves: 0, permissions: 0, positions: 0, roleVisuals: 0, typeChanges: 0 };
    for (const change of plan.changes) {
        for (const field of readChangedFields(change.details)) {
            if (field === 'name') summary.names += 1;
            if (field === 'parentId') summary.parentMoves += 1;
            if (field === 'position' || field === 'roleOrder' || field === 'channelOrder') summary.positions += 1;
            if (field === 'type') summary.typeChanges += 1;
            if (field === 'permissions' || field === 'permissionOverwrites') summary.permissions += 1;
            if (field === 'color' || field === 'hoist' || field === 'mentionable') summary.roleVisuals += 1;
        }
    }
    return summary;
}

function toDashboardDriftPreviewAction(
    action: DashboardBlueprintPlan['changes'][number],
    index: number
): DashboardBlueprintDriftPreviewAction {
    return {
        id: `drift-${index + 1}`,
        sequence: index + 1,
        actionType: action.actionType,
        targetType: action.targetType,
        ...(action.targetId ? { targetId: action.targetId } : {}),
        ...(action.label ? { label: action.label } : {}),
        fields: readChangedFields(action.details),
        details: action.details,
    };
}

function readChangedFields(details: Record<string, unknown>): string[] {
    const changes = details.changes;
    if (!Array.isArray(changes)) return [];
    return changes.flatMap((change) =>
        change && typeof change === 'object' && typeof (change as Record<string, unknown>).field === 'string'
            ? [(change as { field: string }).field]
            : []
    );
}

function createStructureExportFileName(guildName: string, exportedAt: string | undefined): string {
    const stamp = (exportedAt ?? new Date().toISOString()).replaceAll(/[:.]/g, '-');
    return `${sanitizeDownloadName(guildName)}-${stamp}.json`;
}

function createBackupDownloadFileName(name: string): string {
    return `${sanitizeDownloadName(name)}.json`;
}

function normalizeBackupDisplayName(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function sanitizeDownloadName(value: string): string {
    const normalized = normalizeBackupDisplayName(value)
        .replace(/[^a-zA-Z0-9._ -]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.-]+|[.-]+$/g, '');
    return normalized || 'server-blueprint';
}
