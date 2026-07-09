import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    createStructureBackup,
    createStructureImportRun,
    deleteStructureBackup,
    findLatestStructureDriftBaselineBackupByGuildId,
    findStructureBackupByGuildId,
    findStructureBackupSettingsByGuildId,
    findStructureImportRunByGuildId,
    findStructureImportRunWithActionsByGuildId,
    findStructureObservedEventStateByGuildId,
    listStructureBackupSummaryPageByGuildId,
    listStructureImportActionsByRunIdPage,
    listStructureImportRunsByGuildId,
    recordStructureImportActionsBatch,
    renameStructureBackup,
    structureAuditActions,
    structureBackupSources,
    structureBackupStatuses,
    structureImportActionStatuses,
    structureImportRunStatuses,
    updateStructureImportRunStatus,
    upsertStructureBackupSettings,
} from '@neonflux/db';
import type {
    StructureBackupRecord,
    StructureBackupSettingsRecord,
    StructureBackupSummaryPageRecord,
    StructureBackupSummaryRecord,
    StructureImportActionRecord,
    StructureImportRunRecord,
    StructureImportRunWithActionsRecord,
    StructureObservedEventStateRecord,
} from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';

import { getWebDb } from './db.server.js';
import { loadAuthorizedStructureContext } from './dashboard-structure-context.server.js';
import type {
    AuthorizedStructureContext,
    DashboardStructureErrorResult,
} from './dashboard-structure-context.server.js';
import {
    diffDashboardStructureSnapshot,
    normalizeDashboardStructureSnapshot,
    toDashboardStructureSnapshot,
} from './dashboard-structure-diff.js';
import type { DashboardStructurePlan, DashboardStructureSnapshot } from './dashboard-structure-diff.js';

const dashboardImportActionInlineLimit = 100;
const dashboardBackupPageSize = 50;

export type DashboardStructureBackupSummary = {
    id: string;
    name: string;
    source: string;
    status: string;
    errorMessage?: string;
    createdByUserId?: string;
    createdAt: string;
    completedAt: string;
    roleCount: number;
    categoryCount: number;
    channelCount: number;
};

export type DashboardStructureBackupSettings = {
    enabled: boolean;
    cadenceWeeks: number;
    retentionDays: number;
    lastAttemptAt?: string;
    lastSuccessAt?: string;
    lastErrorMessage?: string;
    nextBackupAt?: string;
    nextDriftCheckAt?: string;
    nextRetentionPruneAt?: string;
    scheduledDrift?: DashboardStructureScheduledDriftStatus;
};

export type DashboardStructureScheduledDriftStatus = {
    status: string;
    checkedAt?: string;
    nextCheckAt?: string;
    errorMessage?: string;
    changeCount?: number;
    baselineBackupId?: string;
    baselineName?: string;
    summary?: DashboardStructurePlan['summary'];
    fieldSummary?: DashboardStructureDriftFieldSummary;
    liveCounts?: { categories: number; channels: number; roles: number };
    hasMorePreview: boolean;
};

type DashboardStructureJsonValue =
    | string
    | number
    | boolean
    | null
    | DashboardStructureJsonValue[]
    | { [key: string]: DashboardStructureJsonValue };

type DashboardStructureJsonRecord = {
    [key: string]: DashboardStructureJsonValue;
};

type StructureAuditPayload = {
    action: string;
    actorUserId: string;
    metadata: Record<string, unknown>;
    targetId?: string;
};

export type DashboardStructureImportAction = {
    id: string;
    sequence: number;
    actionType: string;
    targetType: string;
    targetId?: string;
    status: string;
    label?: string;
    details: DashboardStructureJsonRecord;
};

export type DashboardStructureImportRun = {
    id: string;
    status: string;
    createdByUserId?: string;
    createdAt: string;
    updatedAt: string;
    summary: DashboardStructurePlan['summary'];
    actionCount: number;
    actions: DashboardStructureImportAction[];
    requestedSnapshot?: DashboardStructureSnapshot;
    requestedSnapshotStoredAt?: string;
};

export type DashboardStructureImportActionPage = {
    actions: DashboardStructureImportAction[];
    nextCursor?: string;
};

export type DashboardStructureDriftInput = {
    baselineBackupId?: string;
    guildId: string;
};

export type DashboardStructureDriftPreviewAction = {
    id: string;
    sequence: number;
    actionType: string;
    targetType: string;
    targetId?: string;
    label?: string;
    fields: string[];
    details: DashboardStructureJsonRecord;
};

export type DashboardStructureDriftFieldSummary = {
    names: number;
    parentMoves: number;
    permissions: number;
    positions: number;
    roleVisuals: number;
    typeChanges: number;
};

export type DashboardStructureDriftResult =
    | {
          type: 'structure-drift';
          baseline: DashboardStructureBackupSummary;
          checkedAt: string;
          fieldSummary: DashboardStructureDriftFieldSummary;
          hasMorePreview: boolean;
          liveCounts: { categories: number; channels: number; roles: number };
          previewActions: DashboardStructureDriftPreviewAction[];
          summary: DashboardStructurePlan['summary'];
      }
    | { type: 'no-baseline' }
    | { type: 'backup-json-unavailable' }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

type DashboardStructureObservedState = {
    observedChangeCount: number;
    targetChangeCounts: Record<string, number>;
    changedSinceLastBackup: boolean;
    lastEventType?: string;
    lastTargetType?: string;
    lastTargetId?: string;
    lastObservedAt?: string;
};

export type DashboardStructureSettingsResult =
    | {
          type: 'settings';
          backups: DashboardStructureBackupSummary[];
          backupNextCursor?: string;
          backupSettings: DashboardStructureBackupSettings;
          importRuns: DashboardStructureImportRun[];
          observedState: DashboardStructureObservedState;
      }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupResult =
    | {
          type: 'backup-created';
          backup: DashboardStructureBackupSummary;
          backupJson: string;
      }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

export type DashboardStructureCurrentExportResult =
    | {
          type: 'structure-export-created';
          fileName: string;
          structureJson: string;
      }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupJsonResult =
    | {
          type: 'backup-json';
          backupId: string;
          fileName: string;
          backupJson: string;
      }
    | { type: 'backup-json-unavailable' }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupPageInput = {
    cursor?: string;
    guildId: string;
    limit?: number;
};

export type DashboardStructureBackupPageResult =
    | {
          type: 'backup-page';
          page: DashboardStructureBackupPage;
      }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupPage = {
    backups: DashboardStructureBackupSummary[];
    nextCursor?: string;
};

export type DashboardStructureBackupRenameInput = {
    backupId: string;
    guildId: string;
    name: string;
};

export type DashboardStructureBackupRenameResult =
    | {
          type: 'backup-renamed';
          backup: DashboardStructureBackupSummary;
      }
    | { type: 'invalid-input'; message: string }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupDeleteInput = {
    backupId: string;
    guildId: string;
};

export type DashboardStructureBackupDeleteResult =
    | {
          type: 'backup-deleted';
          backupId: string;
      }
    | { type: 'invalid-input'; message: string }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupImportInput = {
    backupId: string;
    guildId: string;
};

export type DashboardStructureBackupImportResult =
    | {
          type: 'backup-import-created';
          importRun: DashboardStructureImportRun;
      }
    | { type: 'backup-json-unavailable' }
    | { type: 'bot-token-missing' }
    | { type: 'invalid-input'; message: string }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupSettingsInput = {
    cadenceWeeks: number;
    enabled: boolean;
    guildId: string;
    retentionDays: number;
};

export type DashboardStructureBackupSettingsResult =
    | {
          type: 'backup-settings-saved';
          backupSettings: DashboardStructureBackupSettings;
      }
    | { type: 'invalid-input'; message: string }
    | DashboardStructureErrorResult;

export type DashboardStructureDryRunResult =
    | {
          type: 'dry-run-created';
          importRun: DashboardStructureImportRun;
      }
    | { type: 'invalid-input'; message: string }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

export type DashboardStructureDryRunInput = {
    guildId: string;
    backupJson: string;
    importMode?: 'merge' | 'replace';
};

export type DashboardStructureConfirmInput = {
    guildId: string;
    importRunId: string;
    confirmationText: string;
};

export type DashboardStructureConfirmResult =
    | {
          type: 'confirmed';
          importRun: DashboardStructureImportRun;
      }
    | { type: 'invalid-input'; message: string }
    | { type: 'confirmation-mismatch'; expectedText: string }
    | { type: 'not-confirmable'; status: string }
    | DashboardStructureErrorResult;

export type DashboardStructureRetryInput = {
    guildId: string;
    importRunId: string;
};

export type DashboardStructureRetryResult =
    | {
          type: 'retry-created';
          importRun: DashboardStructureImportRun;
      }
    | { type: 'invalid-input'; message: string }
    | { type: 'not-retryable'; status: string }
    | DashboardStructureErrorResult;

export type DashboardStructureActionPageInput = {
    cursor?: string;
    guildId: string;
    importRunId: string;
    limit?: number;
};

export type DashboardStructureActionPageResult =
    | {
          type: 'action-page';
          page: DashboardStructureImportActionPage;
      }
    | { type: 'invalid-input'; message: string }
    | DashboardStructureErrorResult;

export async function loadDashboardStructureSettings(
    request: Request,
    guildId: string
): Promise<DashboardStructureSettingsResult> {
    const context = await loadAuthorizedStructureContext(request, guildId);

    if (context.type !== 'authorized') return context;

    const database = await getWebDb();
    const backupsResult = await listStructureBackupSummaryPageByGuildId(database.db, {
        guildId: context.guild.id,
        limit: dashboardBackupPageSize,
    });
    const backupSettingsResult = await findStructureBackupSettingsByGuildId(database.db, {
        guildId: context.guild.id,
    });
    const runsResult = await listStructureImportRunsByGuildId(database.db, {
        guildId: context.guild.id,
        limit: 20,
    });
    const observedStateResult = await findStructureObservedEventStateByGuildId(database.db, {
        guildId: context.guild.id,
    });

    if (backupsResult.isErr() || backupSettingsResult.isErr() || runsResult.isErr() || observedStateResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'settings',
        backups: backupsResult.value.backups.map(toDashboardBackupSummary),
        ...(backupsResult.value.nextCursor ? { backupNextCursor: backupsResult.value.nextCursor } : {}),
        backupSettings: toDashboardBackupSettings(backupSettingsResult.value),
        importRuns: runsResult.value.map(toDashboardImportRun),
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

    if (pageResult.isErr()) return mapRepositoryError(pageResult.error);

    return {
        type: 'backup-page',
        page: toDashboardBackupPage(pageResult.value),
    };
}

export async function exportDashboardStructure(
    request: Request,
    guildId: string
): Promise<DashboardStructureBackupResult> {
    const context = await loadAuthorizedStructureContext(request, guildId);

    if (context.type !== 'authorized') return context;

    return createDashboardStructureBackup(context, structureBackupSources.manual);
}

export async function downloadDashboardStructureExport(
    request: Request,
    guildId: string
): Promise<DashboardStructureCurrentExportResult> {
    const context = await loadAuthorizedStructureContext(request, guildId);

    if (context.type !== 'authorized') return context;

    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) return { type: 'bot-token-missing' };

    const structureResult = await readFluxerBotGuildStructure({
        botToken,
        guildId: context.guild.id,
    });

    if (structureResult.isErr()) return { type: 'structure-read-failed' };

    const snapshot = toDashboardStructureSnapshot(structureResult.value);

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
    const backupResult = await findStructureBackupByGuildId(database.db, {
        backupId,
        guildId: context.guild.id,
    });

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
        : await findLatestStructureDriftBaselineBackupByGuildId(database.db, {
              guildId: context.guild.id,
          });

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

    const botToken = loadWebConfig().fluxerBotToken;
    if (!botToken) return { type: 'bot-token-missing' };

    const currentResult = await readFluxerBotGuildStructure({
        botToken,
        guildId: context.guild.id,
    });

    if (currentResult.isErr()) return { type: 'structure-read-failed' };

    const current = toDashboardStructureSnapshot(currentResult.value);
    const plan = diffDashboardStructureSnapshot(current, requestedResult.snapshot);

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
        audit: createStructureAuditPayload(context, structureAuditActions.backupRenamed, backupId, {
            name,
        }),
        backupId,
        guildId: context.guild.id,
        name,
    });

    if (result.isErr()) return mapRepositoryError(result.error);

    return {
        type: 'backup-renamed',
        backup: toDashboardBackupSummary(result.value),
    };
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
    const result = await deleteStructureBackup(database.db, {
        audit: createStructureAuditPayload(context, structureAuditActions.backupDeleted, backupId, {}),
        backupId,
        guildId: context.guild.id,
    });

    if (result.isErr()) return mapRepositoryError(result.error);

    return {
        type: 'backup-deleted',
        backupId,
    };
}

export async function importDashboardStructureBackup(
    request: Request,
    input: DashboardStructureBackupImportInput
): Promise<DashboardStructureBackupImportResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const backupId = input.backupId.trim();
    if (!backupId) return { type: 'invalid-input', message: 'Choose a backup to import.' };

    const database = await getWebDb();
    const backupResult = await findStructureBackupByGuildId(database.db, {
        backupId,
        guildId: context.guild.id,
    });

    if (backupResult.isErr()) return mapRepositoryError(backupResult.error);
    if (!backupResult.value.structure) return { type: 'backup-json-unavailable' };

    const requestedResult = normalizeDashboardStructurePayload(backupResult.value.structure);
    if (requestedResult.type === 'invalid-input') return requestedResult;

    const botToken = loadWebConfig().fluxerBotToken;
    if (!botToken) return { type: 'bot-token-missing' };

    const currentResult = await readFluxerBotGuildStructure({
        botToken,
        guildId: context.guild.id,
    });

    if (currentResult.isErr()) return { type: 'structure-read-failed' };

    const current = toDashboardStructureSnapshot(currentResult.value);
    const plan = diffDashboardStructureSnapshot(current, requestedResult.snapshot);
    const runResult = await persistStructureImportDryRun(context, plan, requestedResult.snapshot, {
        audit: (importRunId) =>
            createStructureAuditPayload(context, structureAuditActions.backupImportCreated, backupResult.value.id, {
                actionCount: plan.actions.length,
                importRunId,
            }),
        source: 'backup',
        sourceBackupId: backupResult.value.id,
    });

    if (runResult.type !== 'dry-run-created') return runResult;

    return {
        type: 'backup-import-created',
        importRun: runResult.importRun,
    };
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

    if (result.isErr()) return mapRepositoryError(result.error);

    return {
        type: 'backup-settings-saved',
        backupSettings: toDashboardBackupSettings(result.value),
    };
}

export async function createDashboardStructureImportDryRun(
    request: Request,
    input: DashboardStructureDryRunInput
): Promise<DashboardStructureDryRunResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const requestedResult = parseDashboardStructureSnapshot(input.backupJson);

    if (requestedResult.type === 'invalid-input') return requestedResult;

    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) return { type: 'bot-token-missing' };

    const currentResult = await readFluxerBotGuildStructure({
        botToken,
        guildId: context.guild.id,
    });

    if (currentResult.isErr()) return { type: 'structure-read-failed' };

    const current = toDashboardStructureSnapshot(currentResult.value);
    const importMode = input.importMode === 'replace' ? 'replace' : 'merge';
    const plan = diffDashboardStructureSnapshot(current, requestedResult.snapshot, {
        includeDeletes: importMode === 'replace',
    });
    const runResult = await persistStructureImportDryRun(context, plan, requestedResult.snapshot, {
        audit: (importRunId) =>
            createStructureAuditPayload(context, structureAuditActions.importDryRunCreated, importRunId, {
                actionCount: plan.actions.length,
                createCount: plan.summary.creates,
                updateCount: plan.summary.updates,
                deleteCount: plan.summary.deletes,
                importMode,
            }),
        importMode,
    });

    if (runResult.type !== 'dry-run-created') return runResult;

    return runResult;
}

export async function confirmDashboardStructureImportRun(
    request: Request,
    input: DashboardStructureConfirmInput
): Promise<DashboardStructureConfirmResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const importRunId = input.importRunId.trim();

    if (!importRunId) {
        return { type: 'invalid-input', message: 'Choose an import dry-run to confirm.' };
    }

    const expectedText = getStructureImportConfirmationText(importRunId);

    if (input.confirmationText.trim() !== expectedText) {
        return { type: 'confirmation-mismatch', expectedText };
    }

    const database = await getWebDb();
    const importRunResult = await findStructureImportRunWithActionsByGuildId(database.db, {
        guildId: context.guild.id,
        runId: importRunId,
    });

    if (importRunResult.isErr()) return mapRepositoryError(importRunResult.error);

    if (importRunResult.value.status !== structureImportRunStatuses.dryRunComplete) {
        return { type: 'not-confirmable', status: importRunResult.value.status };
    }

    const summary = summarizeActions(importRunResult.value.actions);
    const confirmedResult = await updateStructureImportRunStatus(database.db, {
        audit: createStructureAuditPayload(context, structureAuditActions.importConfirmed, importRunId, {
            actionCount: importRunResult.value.actions.length,
            createCount: summary.creates,
            updateCount: summary.updates,
            deleteCount: summary.deletes,
        }),
        runId: importRunId,
        status: structureImportRunStatuses.confirmed,
    });

    if (confirmedResult.isErr()) {
        if (confirmedResult.error.type === 'invalid-status-transition') {
            return { type: 'not-confirmable', status: confirmedResult.error.from };
        }

        return mapRepositoryError(confirmedResult.error);
    }

    const confirmedRun = toDashboardImportRun({
        ...confirmedResult.value,
        actions: importRunResult.value.actions,
    });

    return {
        type: 'confirmed',
        importRun: confirmedRun,
    };
}

export async function retryDashboardStructureImportRun(
    request: Request,
    input: DashboardStructureRetryInput
): Promise<DashboardStructureRetryResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const importRunId = input.importRunId.trim();
    if (!importRunId) return { type: 'invalid-input', message: 'Choose a failed import run to retry.' };

    const database = await getWebDb();
    const importRunResult = await findStructureImportRunWithActionsByGuildId(database.db, {
        guildId: context.guild.id,
        runId: importRunId,
    });

    if (importRunResult.isErr()) return mapRepositoryError(importRunResult.error);
    if (importRunResult.value.status !== structureImportRunStatuses.failed) {
        return { type: 'not-retryable', status: importRunResult.value.status };
    }

    const failedActions = importRunResult.value.actions.filter(
        (action) => action.status === structureImportActionStatuses.failed
    );
    if (failedActions.length === 0) return { type: 'invalid-input', message: 'This run has no failed actions.' };

    const retryPlan = {
        ...importRunResult.value.plan,
        retryOfRunId: importRunResult.value.id,
        sourceTargetMap: readApplySourceTargetMap(importRunResult.value.plan),
        summary: summarizeActions(failedActions),
    };
    const retryRunResult = await createStructureImportRun(database.db, {
        createdByUserId: context.actor.actorUserId,
        guildId: context.guild.id,
        plan: toJsonRecord(retryPlan),
    });

    if (retryRunResult.isErr()) return { type: 'database-error' };

    const retryActions = await recordActionBatches(
        retryRunResult.value.id,
        failedActions.map((action, index) => ({
            actionType: action.actionType,
            details: toJsonRecord({
                ...action.details,
                retryOfActionId: action.id,
            }),
            sequence: index,
            status: structureImportActionStatuses.dryRun,
            targetId: action.targetId ?? undefined,
            targetType: action.targetType,
        }))
    );

    if (retryActions === 'database-error') {
        await markStructureImportRunActionWriteFailed(retryRunResult.value.id, retryRunResult.value.plan);
        return { type: 'database-error' };
    }

    const updatedRunResult = await updateStructureImportRunStatus(database.db, {
        audit: createStructureAuditPayload(context, structureAuditActions.importRetryCreated, retryRunResult.value.id, {
            actionCount: failedActions.length,
            retryOfRunId: importRunId,
        }),
        runId: retryRunResult.value.id,
        status: structureImportRunStatuses.dryRunComplete,
    });

    if (updatedRunResult.isErr()) return { type: 'database-error' };

    const importRun = toDashboardImportRun({ ...updatedRunResult.value, actions: retryActions });

    return { type: 'retry-created', importRun };
}

export async function readDashboardStructureImportActionPage(
    request: Request,
    input: DashboardStructureActionPageInput
): Promise<DashboardStructureActionPageResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const importRunId = input.importRunId.trim();
    if (!importRunId) return { type: 'invalid-input', message: 'Choose an import run.' };

    const database = await getWebDb();
    const importRunResult = await findStructureImportRunByGuildId(database.db, {
        guildId: context.guild.id,
        runId: importRunId,
    });
    if (importRunResult.isErr()) return mapRepositoryError(importRunResult.error);

    const pageResult = await listStructureImportActionsByRunIdPage(database.db, {
        cursor: input.cursor,
        limit: input.limit,
        runId: importRunId,
    });

    if (pageResult.isErr()) return mapRepositoryError(pageResult.error);

    return {
        type: 'action-page',
        page: {
            actions: pageResult.value.actions.map(toDashboardImportAction),
            ...(pageResult.value.nextCursor ? { nextCursor: pageResult.value.nextCursor } : {}),
        },
    };
}

async function createDashboardStructureBackup(
    context: AuthorizedStructureContext,
    source: string
): Promise<DashboardStructureBackupResult> {
    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) {
        const failedBackup = await recordFailedDashboardStructureBackup(
            context,
            source,
            'The web service needs FLUXER_BOT_TOKEN to read server layout.'
        );

        if (failedBackup === 'database-error') return { type: 'database-error' };
        return { type: 'bot-token-missing' };
    }

    const structureResult = await readFluxerBotGuildStructure({
        botToken,
        guildId: context.guild.id,
    });

    if (structureResult.isErr()) {
        const failedBackup = await recordFailedDashboardStructureBackup(
            context,
            source,
            `Could not read server layout: ${structureResult.error.type}.`
        );

        if (failedBackup === 'database-error') return { type: 'database-error' };
        return { type: 'structure-read-failed' };
    }

    const snapshot = toDashboardStructureSnapshot(structureResult.value);
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

async function persistStructureImportDryRun(
    context: AuthorizedStructureContext,
    plan: DashboardStructurePlan,
    requestedSnapshot: DashboardStructureSnapshot,
    options: {
        audit?: (importRunId: string) => StructureAuditPayload;
        importMode?: 'merge' | 'replace';
        source?: string;
        sourceBackupId?: string;
    } = {}
): Promise<DashboardStructureDryRunResult> {
    const database = await getWebDb();
    const requestedSnapshotStoredAt = new Date().toISOString();
    const runResult = await createStructureImportRun(database.db, {
        guildId: context.guild.id,
        createdByUserId: context.actor.actorUserId,
        plan: toJsonRecord({
            summary: plan.summary,
            requestedGuildId: requestedSnapshot.guildId ?? null,
            requestedExportedAt: requestedSnapshot.exportedAt ?? null,
            requestedSnapshot,
            requestedSnapshotStoredAt,
            requestedSnapshotVersion: 1,
            source: options.source ?? 'dashboard-json',
            ...(options.importMode ? { importMode: options.importMode } : {}),
        }),
        ...(options.sourceBackupId ? { sourceBackupId: options.sourceBackupId } : {}),
    });

    if (runResult.isErr()) return { type: 'database-error' };

    const actionRecords = await recordActionBatches(
        runResult.value.id,
        plan.actions.map((action, index) => ({
            actionType: action.actionType,
            targetType: action.targetType,
            ...(action.targetId ? { targetId: action.targetId } : {}),
            sequence: index,
            status: structureImportActionStatuses.dryRun,
            details: toJsonRecord(action.details),
        }))
    );

    if (actionRecords === 'database-error') {
        await markStructureImportRunActionWriteFailed(runResult.value.id, runResult.value.plan);
        return { type: 'database-error' };
    }

    const updatedRunResult = await updateStructureImportRunStatus(database.db, {
        audit: options.audit?.(runResult.value.id),
        runId: runResult.value.id,
        status: structureImportRunStatuses.dryRunComplete,
    });

    if (updatedRunResult.isErr()) return { type: 'database-error' };

    return {
        type: 'dry-run-created',
        importRun: toDashboardImportRun({
            ...updatedRunResult.value,
            actions: actionRecords,
        }),
    };
}

async function recordActionBatches(
    runId: string,
    actions: Array<{
        actionType: string;
        details?: Record<string, unknown>;
        sequence: number;
        status?: string;
        targetId?: string;
        targetType: string;
    }>
): Promise<StructureImportActionRecord[] | 'database-error'> {
    if (actions.length === 0) return [];

    const database = await getWebDb();
    const records: StructureImportActionRecord[] = [];

    for (let index = 0; index < actions.length; index += 100) {
        const result = await recordStructureImportActionsBatch(database.db, {
            runId,
            actions: actions.slice(index, index + 100),
        });

        if (result.isErr()) return 'database-error';

        if (records.length <= dashboardImportActionInlineLimit) {
            records.push(...result.value.slice(0, dashboardImportActionInlineLimit - records.length));
        }
    }

    return records;
}

async function markStructureImportRunActionWriteFailed(runId: string, plan: Record<string, unknown>): Promise<void> {
    const database = await getWebDb();

    await updateStructureImportRunStatus(database.db, {
        runId,
        status: structureImportRunStatuses.cancelled,
        plan: {
            ...plan,
            errorType: 'action-write-failed',
        },
    });
}

function parseDashboardStructureSnapshot(
    backupJson: string
): { type: 'valid'; snapshot: DashboardStructureSnapshot } | { type: 'invalid-input'; message: string } {
    const trimmedJson = backupJson.trim();

    if (!trimmedJson) return { type: 'invalid-input', message: 'Paste exported server blueprint JSON first.' };

    try {
        const parsed = JSON.parse(trimmedJson) as unknown;
        const normalized = normalizeDashboardStructureSnapshot(parsed);

        if (normalized.type === 'invalid') {
            return { type: 'invalid-input', message: normalized.message };
        }

        return { type: 'valid', snapshot: normalized.snapshot };
    } catch {
        return { type: 'invalid-input', message: 'Server blueprint JSON could not be parsed.' };
    }
}

function normalizeDashboardStructurePayload(
    payload: unknown
): { type: 'valid'; snapshot: DashboardStructureSnapshot } | { type: 'invalid-input'; message: string } {
    const normalized = normalizeDashboardStructureSnapshot(payload);

    if (normalized.type === 'invalid') {
        return { type: 'invalid-input', message: normalized.message };
    }

    return { type: 'valid', snapshot: normalized.snapshot };
}

function createStructureAuditPayload(
    context: AuthorizedStructureContext,
    action: string,
    targetId: string | undefined,
    metadata: Record<string, unknown>
): StructureAuditPayload {
    return {
        action,
        actorUserId: context.actor.actorUserId,
        metadata: {
            source: 'dashboard',
            ...metadata,
            ...context.actor.metadata,
        },
        ...(targetId ? { targetId } : {}),
    };
}

function toDashboardBackupPage(record: StructureBackupSummaryPageRecord): DashboardStructureBackupPage {
    return {
        backups: record.backups.map(toDashboardBackupSummary),
        ...(record.nextCursor ? { nextCursor: record.nextCursor } : {}),
    };
}

function toDashboardBackupSummary(
    record: StructureBackupRecord | StructureBackupSummaryRecord
): DashboardStructureBackupSummary {
    return {
        id: record.id,
        name: record.name,
        source: record.source,
        status: record.status,
        ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
        ...(record.createdByUserId ? { createdByUserId: record.createdByUserId } : {}),
        createdAt: record.createdAt.toISOString(),
        completedAt: record.completedAt.toISOString(),
        roleCount: record.roleCount,
        categoryCount: record.categoryCount,
        channelCount: record.channelCount,
    };
}

function summarizeDriftFields(plan: DashboardStructurePlan): DashboardStructureDriftFieldSummary {
    const fieldSummary: DashboardStructureDriftFieldSummary = {
        names: 0,
        parentMoves: 0,
        permissions: 0,
        positions: 0,
        roleVisuals: 0,
        typeChanges: 0,
    };

    for (const action of plan.actions) {
        for (const field of readChangedFields(action.details)) {
            if (field === 'name') fieldSummary.names += 1;
            if (field === 'parentId') fieldSummary.parentMoves += 1;
            if (field === 'position') fieldSummary.positions += 1;
            if (field === 'type') fieldSummary.typeChanges += 1;
            if (field === 'permissions' || field === 'permissionOverwrites') fieldSummary.permissions += 1;
            if (field === 'color' || field === 'hoist' || field === 'mentionable') fieldSummary.roleVisuals += 1;
        }
    }

    return fieldSummary;
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

function toDashboardBackupSettings(record: StructureBackupSettingsRecord): DashboardStructureBackupSettings {
    const scheduledDrift = toDashboardScheduledDriftStatus(record);

    return {
        enabled: record.enabled,
        cadenceWeeks: record.cadenceWeeks,
        retentionDays: record.retentionDays,
        ...(record.lastAttemptAt ? { lastAttemptAt: record.lastAttemptAt.toISOString() } : {}),
        ...(record.lastSuccessAt ? { lastSuccessAt: record.lastSuccessAt.toISOString() } : {}),
        ...(record.lastErrorMessage ? { lastErrorMessage: record.lastErrorMessage } : {}),
        ...(record.nextBackupAt ? { nextBackupAt: record.nextBackupAt.toISOString() } : {}),
        ...(record.nextDriftCheckAt ? { nextDriftCheckAt: record.nextDriftCheckAt.toISOString() } : {}),
        ...(record.nextRetentionPruneAt ? { nextRetentionPruneAt: record.nextRetentionPruneAt.toISOString() } : {}),
        ...(scheduledDrift ? { scheduledDrift } : {}),
    };
}

function toDashboardScheduledDriftStatus(
    record: StructureBackupSettingsRecord
): DashboardStructureScheduledDriftStatus | undefined {
    if (!record.lastDriftStatus && !record.nextDriftCheckAt) return undefined;

    return {
        status: record.lastDriftStatus ?? 'pending',
        ...(record.lastDriftCheckedAt ? { checkedAt: record.lastDriftCheckedAt.toISOString() } : {}),
        ...(record.nextDriftCheckAt ? { nextCheckAt: record.nextDriftCheckAt.toISOString() } : {}),
        ...(record.lastDriftErrorMessage ? { errorMessage: record.lastDriftErrorMessage } : {}),
        ...(record.lastDriftChangeCount !== null ? { changeCount: record.lastDriftChangeCount } : {}),
        ...(record.lastDriftBaselineBackupId ? { baselineBackupId: record.lastDriftBaselineBackupId } : {}),
        ...(record.lastDriftBaselineName ? { baselineName: record.lastDriftBaselineName } : {}),
        ...(readPlanSummaryRecord(record.lastDriftSummary)
            ? { summary: readPlanSummaryRecord(record.lastDriftSummary) }
            : {}),
        ...(readFieldSummaryRecord(record.lastDriftFieldSummary)
            ? { fieldSummary: readFieldSummaryRecord(record.lastDriftFieldSummary) }
            : {}),
        ...(readLiveCountsRecord(record.lastDriftLiveCounts)
            ? { liveCounts: readLiveCountsRecord(record.lastDriftLiveCounts) }
            : {}),
        hasMorePreview: record.lastDriftHasMorePreview,
    };
}

function readPlanSummaryRecord(value: Record<string, unknown> | null): DashboardStructurePlan['summary'] | undefined {
    if (!value) return undefined;

    return {
        creates: readNonNegativeNumber(value.creates),
        updates: readNonNegativeNumber(value.updates),
        deletes: readNonNegativeNumber(value.deletes),
        roles: readNonNegativeNumber(value.roles),
        categories: readNonNegativeNumber(value.categories),
        channels: readNonNegativeNumber(value.channels),
    };
}

function readFieldSummaryRecord(
    value: Record<string, unknown> | null
): DashboardStructureDriftFieldSummary | undefined {
    if (!value) return undefined;

    return {
        names: readNonNegativeNumber(value.names),
        parentMoves: readNonNegativeNumber(value.parentMoves),
        permissions: readNonNegativeNumber(value.permissions),
        positions: readNonNegativeNumber(value.positions),
        roleVisuals: readNonNegativeNumber(value.roleVisuals),
        typeChanges: readNonNegativeNumber(value.typeChanges),
    };
}

function readLiveCountsRecord(
    value: Record<string, unknown> | null
): { categories: number; channels: number; roles: number } | undefined {
    if (!value) return undefined;

    return {
        categories: readNonNegativeNumber(value.categories),
        channels: readNonNegativeNumber(value.channels),
        roles: readNonNegativeNumber(value.roles),
    };
}

function readNonNegativeNumber(value: unknown): number {
    return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : 0;
}

export function toDashboardImportRun(
    record: StructureImportRunRecord | StructureImportRunWithActionsRecord
): DashboardStructureImportRun {
    const actions = 'actions' in record ? record.actions : [];
    const summary = readPlanSummary(record.plan);
    const requestedSnapshot = readRequestedSnapshot(record.plan);
    const requestedSnapshotStoredAt = readRequestedSnapshotStoredAt(record.plan);

    return {
        id: record.id,
        status: record.status,
        ...(record.createdByUserId ? { createdByUserId: record.createdByUserId } : {}),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        summary,
        actionCount: readActionCount(summary, actions),
        actions: shouldInlineImportActions(summary, actions) ? actions.map(toDashboardImportAction) : [],
        ...(requestedSnapshot ? { requestedSnapshot } : {}),
        ...(requestedSnapshot && requestedSnapshotStoredAt ? { requestedSnapshotStoredAt } : {}),
    };
}

function readActionCount(summary: DashboardStructurePlan['summary'], actions: StructureImportActionRecord[]): number {
    const summarizedCount = summary.creates + summary.updates + summary.deletes;

    return summarizedCount > 0 ? summarizedCount : actions.length;
}

function shouldInlineImportActions(
    summary: DashboardStructurePlan['summary'],
    actions: StructureImportActionRecord[]
): boolean {
    const actionCount = readActionCount(summary, actions);

    return actions.length > 0 && actions.length === actionCount && actions.length <= dashboardImportActionInlineLimit;
}

function toDashboardImportAction(record: StructureImportActionRecord): DashboardStructureImportAction {
    const details = toJsonRecord(record.details);
    const label = typeof details.label === 'string' ? details.label : undefined;

    return {
        id: record.id,
        sequence: record.sequence,
        actionType: record.actionType,
        targetType: record.targetType,
        ...(record.targetId ? { targetId: record.targetId } : {}),
        status: record.status,
        ...(label ? { label } : {}),
        details,
    };
}

function toDashboardObservedState(
    record: StructureObservedEventStateRecord,
    settings: StructureBackupSettingsRecord
): DashboardStructureObservedState {
    const lastObservedAt = record.lastObservedAt?.getTime() ?? 0;
    const lastBackupAt = settings.lastSuccessAt?.getTime() ?? 0;

    return {
        observedChangeCount: record.observedChangeCount,
        targetChangeCounts: record.targetChangeCounts,
        changedSinceLastBackup: lastObservedAt > lastBackupAt,
        ...(record.lastEventType ? { lastEventType: record.lastEventType } : {}),
        ...(record.lastTargetType ? { lastTargetType: record.lastTargetType } : {}),
        ...(record.lastTargetId ? { lastTargetId: record.lastTargetId } : {}),
        ...(record.lastObservedAt ? { lastObservedAt: record.lastObservedAt.toISOString() } : {}),
    };
}

function readPlanSummary(plan: Record<string, unknown>): DashboardStructurePlan['summary'] {
    const summary = isObject(plan.summary) ? plan.summary : {};

    return {
        creates: readNumber(summary.creates),
        updates: readNumber(summary.updates),
        deletes: readNumber(summary.deletes),
        roles: readNumber(summary.roles),
        categories: readNumber(summary.categories),
        channels: readNumber(summary.channels),
    };
}

function readRequestedSnapshot(plan: Record<string, unknown>): DashboardStructureSnapshot | undefined {
    if (plan.requestedSnapshotVersion !== 1) return undefined;

    const result = normalizeDashboardStructureSnapshot(plan.requestedSnapshot);
    return result.type === 'valid' ? result.snapshot : undefined;
}

function readRequestedSnapshotStoredAt(plan: Record<string, unknown>): string | undefined {
    return typeof plan.requestedSnapshotStoredAt === 'string' && plan.requestedSnapshotStoredAt.trim()
        ? plan.requestedSnapshotStoredAt.trim()
        : undefined;
}

function summarizeActions(actions: StructureImportActionRecord[]): DashboardStructurePlan['summary'] {
    return {
        creates: actions.filter((action) => action.actionType === 'create').length,
        updates: actions.filter((action) => action.actionType === 'update').length,
        deletes: actions.filter((action) => action.actionType === 'delete').length,
        roles: actions.filter((action) => action.targetType === 'role').length,
        categories: actions.filter((action) => action.targetType === 'category').length,
        channels: actions.filter((action) => action.targetType === 'channel').length,
    };
}

function readApplySourceTargetMap(plan: Record<string, unknown>): Record<string, unknown> {
    const applySummary = isObject(plan.applySummary) ? plan.applySummary : {};
    return isObject(applySummary.sourceTargetMap) ? applySummary.sourceTargetMap : {};
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

function mapRepositoryError(error: { type: string }): DashboardStructureErrorResult {
    return error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
}

function getStructureImportConfirmationText(importRunId: string): string {
    return `CONFIRM ${importRunId.trim()}`;
}

function toJsonRecord(value: unknown): DashboardStructureJsonRecord {
    return JSON.parse(JSON.stringify(value)) as DashboardStructureJsonRecord;
}

function readNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
