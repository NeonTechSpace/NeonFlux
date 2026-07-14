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
    structureAuditActions,
    structureBackupSources,
    structureBackupStatuses,
    upsertStructureBackupSettings,
} from '@neonflux/db';

import { readDashboardBotGuildStructure } from './bot-read-client.server.js';
import { getWebDb } from './db.server.js';
import { loadAuthorizedStructureContext } from './dashboard-structure-context.server.js';
import type { AuthorizedStructureContext } from './dashboard-structure-context.server.js';
import { toDashboardStructureExportSnapshot, toDashboardStructureSnapshot } from './dashboard-structure-diff.js';
import type { DashboardStructurePlan } from './dashboard-structure-diff.js';
import type {
    DashboardStructureBackupDeleteInput,
    DashboardStructureBackupDeleteResult,
    DashboardStructureBackupJsonResult,
    DashboardStructureBackupPageInput,
    DashboardStructureBackupPageResult,
    DashboardStructureBackupRenameInput,
    DashboardStructureBackupRenameResult,
    DashboardStructureBackupResult,
    DashboardStructureBackupSettingsInput,
    DashboardStructureBackupSettingsResult,
    DashboardStructureBackupsResult,
    DashboardStructureCurrentExportResult,
    DashboardStructureDriftFieldSummary,
    DashboardStructureDriftInput,
    DashboardStructureDriftPreviewAction,
    DashboardStructureDriftResult,
    DashboardStructureJsonRecord,
} from './dashboard-structure-model.js';
import {
    createStructureAuditPayload,
    dashboardImportActionInlineLimit,
    mapRepositoryError,
    toDashboardBackupPage,
    toDashboardBackupSettings,
    toDashboardBackupSummary,
    toDashboardObservedState,
    toJsonRecord,
} from './dashboard-structure-records.server.js';
import {
    mapBotStructureReadError,
    normalizeDashboardStructurePayload,
    tryDiffDashboardStructureSnapshot,
} from './dashboard-structure-snapshot-planning.server.js';

const dashboardBackupPageSize = 50;

export async function loadDashboardStructureBackups(
    request: Request,
    guildId: string
): Promise<DashboardStructureBackupsResult> {
    const context = await loadAuthorizedStructureContext(request, guildId);
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

export async function readDashboardStructureBackupPage(
    request: Request,
    input: DashboardStructureBackupPageInput
): Promise<DashboardStructureBackupPageResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
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

export async function exportDashboardStructure(
    request: Request,
    guildId: string
): Promise<DashboardStructureBackupResult> {
    const context = await loadAuthorizedStructureContext(request, guildId);
    return context.type === 'authorized'
        ? createDashboardStructureBackup(context, structureBackupSources.manual)
        : context;
}

export async function downloadDashboardStructureExport(
    request: Request,
    guildId: string
): Promise<DashboardStructureCurrentExportResult> {
    const context = await loadAuthorizedStructureContext(request, guildId);
    if (context.type !== 'authorized') return context;
    const structureResult = await readDashboardBotGuildStructure(context.guild.id);
    if (structureResult.isErr()) return mapBotStructureReadError(structureResult.error);
    const snapshot = toDashboardStructureExportSnapshot(structureResult.value);
    return {
        type: 'structure-export-created',
        fileName: createStructureExportFileName(context.guild.name, snapshot.exportedAt),
        structureJson: JSON.stringify(snapshot, null, 2),
    };
}

export async function readDashboardStructureBackupJson(
    request: Request,
    input: { backupId: string; guildId: string }
): Promise<DashboardStructureBackupJsonResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
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

export async function readDashboardStructureDrift(
    request: Request,
    input: DashboardStructureDriftInput
): Promise<DashboardStructureDriftResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
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
    const requestedResult = normalizeDashboardStructurePayload(backupResult.value.structure);
    if (requestedResult.type === 'invalid-input') return { type: 'backup-json-unavailable' };
    const currentResult = await readDashboardBotGuildStructure(context.guild.id);
    if (currentResult.isErr()) return mapBotStructureReadError(currentResult.error);
    const current = toDashboardStructureSnapshot(currentResult.value);
    const planResult = tryDiffDashboardStructureSnapshot(current, requestedResult.snapshot, { policy: 'synchronize' });
    if (planResult.type !== 'valid') return { type: 'backup-json-unavailable' };
    const plan = planResult.plan;
    return {
        type: 'structure-drift',
        baseline: toDashboardBackupSummary(backupResult.value),
        checkedAt: new Date().toISOString(),
        fieldSummary: summarizeDriftFields(plan),
        hasMorePreview: plan.actions.length > dashboardImportActionInlineLimit,
        liveCounts: {
            categories: current.categories.length,
            channels: current.channels.length,
            roles: current.roles.length,
        },
        previewActions: plan.actions.slice(0, dashboardImportActionInlineLimit).map(toDashboardDriftPreviewAction),
        summary: plan.summary,
    };
}

export async function renameDashboardStructureBackup(
    request: Request,
    input: DashboardStructureBackupRenameInput
): Promise<DashboardStructureBackupRenameResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const backupId = input.backupId.trim();
    const name = normalizeBackupDisplayName(input.name);
    if (!backupId) return { type: 'invalid-input', message: 'Choose a backup to rename.' };
    if (!name) return { type: 'invalid-input', message: 'Backup name is required.' };
    if (name.length > 120) return { type: 'invalid-input', message: 'Backup name must be 120 characters or fewer.' };
    const database = await getWebDb();
    const result = await renameStructureBackup(database.db, {
        audit: createStructureAuditPayload(context, structureAuditActions.backupRenamed, backupId, { name }),
        backupId,
        guildId: context.guild.id,
        name,
    });
    return result.isErr()
        ? mapRepositoryError(result.error)
        : { type: 'backup-renamed', backup: toDashboardBackupSummary(result.value) };
}

export async function deleteDashboardStructureBackup(
    request: Request,
    input: DashboardStructureBackupDeleteInput
): Promise<DashboardStructureBackupDeleteResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const backupId = input.backupId.trim();
    if (!backupId) return { type: 'invalid-input', message: 'Choose a backup to delete.' };
    const database = await getWebDb();
    const backupResult = await findStructureBackupByGuildId(database.db, { backupId, guildId: context.guild.id });
    if (backupResult.isErr()) return mapRepositoryError(backupResult.error);
    if (backupResult.value.source === structureBackupSources.restorePoint) return { type: 'restore-point-protected' };
    const result = await deleteStructureBackup(database.db, {
        audit: createStructureAuditPayload(context, structureAuditActions.backupDeleted, backupId, {}),
        backupId,
        guildId: context.guild.id,
    });
    return result.isErr() ? mapRepositoryError(result.error) : { type: 'backup-deleted', backupId };
}

export async function saveDashboardStructureBackupSettings(
    request: Request,
    input: DashboardStructureBackupSettingsInput
): Promise<DashboardStructureBackupSettingsResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    if (!Number.isInteger(input.cadenceWeeks) || input.cadenceWeeks < 1) {
        return { type: 'invalid-input', message: 'Automatic backups use a minimum cadence of 1 week.' };
    }
    if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 180) {
        return { type: 'invalid-input', message: 'Backup retention must be between 1 and 180 days.' };
    }
    const database = await getWebDb();
    const result = await upsertStructureBackupSettings(database.db, {
        audit: createStructureAuditPayload(context, structureAuditActions.backupSettingsUpdated, context.guild.id, {
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

async function createDashboardStructureBackup(
    context: AuthorizedStructureContext,
    source: string
): Promise<DashboardStructureBackupResult> {
    const structureResult = await readDashboardBotGuildStructure(context.guild.id);
    if (structureResult.isErr()) {
        const message =
            structureResult.error === 'not-configured'
                ? 'The bot read service is not configured.'
                : `Could not read server layout: ${structureResult.error}.`;
        const failedBackup = await recordFailedDashboardStructureBackup(context, source, message);
        if (failedBackup === 'database-error') return { type: 'database-error' };
        return mapBotStructureReadError(structureResult.error);
    }
    const snapshot = toDashboardStructureExportSnapshot(structureResult.value);
    const database = await getWebDb();
    const backupResult = await createStructureBackup(database.db, {
        audit: createStructureAuditPayload(context, structureAuditActions.backupCreated, undefined, {
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

async function recordFailedDashboardStructureBackup(
    context: AuthorizedStructureContext,
    source: string,
    errorMessage: string
): Promise<'database-error' | void> {
    const database = await getWebDb();
    const backupResult = await createStructureBackup(database.db, {
        audit: createStructureAuditPayload(context, structureAuditActions.backupFailed, undefined, {
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

function summarizeDriftFields(plan: DashboardStructurePlan): DashboardStructureDriftFieldSummary {
    const summary = { names: 0, parentMoves: 0, permissions: 0, positions: 0, roleVisuals: 0, typeChanges: 0 };
    for (const action of plan.actions) {
        for (const field of readChangedFields(action.details)) {
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
    action: DashboardStructurePlan['actions'][number],
    index: number
): DashboardStructureDriftPreviewAction {
    return {
        id: `drift-${index + 1}`,
        sequence: index + 1,
        actionType: action.actionType,
        targetType: action.targetType,
        ...(action.targetId ? { targetId: action.targetId } : {}),
        ...(action.label ? { label: action.label } : {}),
        fields: readChangedFields(action.details),
        details: action.details as DashboardStructureJsonRecord,
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
