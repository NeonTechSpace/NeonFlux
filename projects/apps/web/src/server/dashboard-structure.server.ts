import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    approveStructureImportPlan,
    createStructureBackup,
    createStructureImportRun,
    deleteStructureBackup,
    findLatestStructureDriftBaselineBackupByGuildId,
    findLatestStructureImportExecution,
    findLatestStructureImportPreflight,
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
    structureImportRunStatuses,
    transitionStructureImportPlanState,
    upsertStructureBackupSettings,
} from '@neonflux/db';
import type {
    StructureBackupRecord,
    StructureBackupSettingsRecord,
    StructureBackupSummaryPageRecord,
    StructureBackupSummaryRecord,
    StructureImportActionRecord,
    StructureImportExecutionRecord,
    StructureImportPreflightRecord,
    StructureImportRunRecord,
    StructureImportRunWithActionsRecord,
    StructureObservedEventStateRecord,
} from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import {
    FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS,
    isFluxerGuildStructureSnapshotJsonWithinByteLimit,
} from '@neonflux/fluxer/guild-structure-diff';

import { getWebDb } from './db.server.js';
import {
    readPersistedCategoryMappings,
    readPersistedChannelMappings,
    readPersistedRoleMappings,
} from './dashboard-structure-apply-plan.js';
import { loadAuthorizedStructureContext } from './dashboard-structure-context.server.js';
import type {
    AuthorizedStructureContext,
    DashboardStructureErrorResult,
} from './dashboard-structure-context.server.js';
import {
    DashboardStructureAmbiguousIdentityError,
    diffDashboardStructureSnapshot,
    normalizeDashboardStructureSnapshot,
    toDashboardStructureSnapshot,
} from './dashboard-structure-diff.js';
import type { DashboardStructurePlan, DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import type { DashboardStructurePreflightReport } from './dashboard-structure-preflight.js';
import {
    createDashboardStructurePlanDigests,
    materializeDashboardStructureReviewDecisions,
    recordDashboardStructureReviewDecisions,
    summarizeDashboardStructureReviewDecisions,
} from './dashboard-structure-plan-persistence.server.js';
import {
    createDashboardStructureRecoveryMetadata,
    loadDashboardStructureRecoverySource,
} from './dashboard-structure-recovery.server.js';
import {
    createEmptyDecisionSummary,
    dashboardStructureExecutionPhases,
    isDashboardStructurePolicy,
} from './dashboard-structure-contracts.js';
import type {
    DashboardStructureDecisionSummary,
    DashboardStructureExecutionProgress,
    DashboardStructurePersistedPreflight,
    DashboardStructurePolicy,
    DashboardStructureReviewDecision,
} from './dashboard-structure-contracts.js';

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

type DashboardStructureScheduledDriftStatus = {
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
    executionActionCount: number;
    actions: DashboardStructureImportAction[];
    requestedSnapshot?: DashboardStructureSnapshot;
    requestedSnapshotStoredAt?: string;
    recoveryAvailable?: boolean;
    verification?: DashboardStructureVerification;
    policy: DashboardStructurePolicy;
    decisionSummary: DashboardStructureDecisionSummary;
    decisions: DashboardStructureReviewDecision[];
    planDigest: string;
    deleteActionCount: number;
    deleteSetDigest?: string;
    preflight?: DashboardStructurePersistedPreflight & { report: DashboardStructurePreflightReport };
    execution?: DashboardStructureExecutionProgress;
};

type DashboardStructureVerification = {
    status: 'matched' | 'mismatch' | 'read-failed';
    verifiedAt: string;
    mismatchCount: number;
    preview: Array<{
        logicalId: string;
        field: string;
        expected?: DashboardStructureJsonValue;
        actual?: DashboardStructureJsonValue;
    }>;
};

type DashboardStructureImportActionPage = {
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

type DashboardStructureDriftFieldSummary = {
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

type DashboardStructureBackupPage = {
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
    | { type: 'restore-point-protected' }
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
    | { type: 'mapping-required'; conflicts: DashboardStructureRoleMappingConflict[] }
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

export type DashboardStructurePlanResult =
    | {
          type: 'plan-created';
          importRun: DashboardStructureImportRun;
      }
    | { type: 'invalid-input'; message: string }
    | { type: 'mapping-required'; conflicts: DashboardStructureRoleMappingConflict[] }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

export type DashboardStructurePlanInput = {
    guildId: string;
    backupJson: string;
    policy: DashboardStructurePolicy;
    roleMappings?: Record<string, string>;
    categoryMappings?: Record<string, string>;
    channelMappings?: Record<string, string>;
};

export type DashboardStructureRoleMappingConflict = {
    targetType: 'role' | 'category' | 'channel';
    name: string;
    sourceIds: string[];
    candidateTargetIds: string[];
};

export type DashboardStructureApprovalInput = {
    guildId: string;
    importRunId: string;
    planDigest: string;
};

export type DashboardStructureApprovalResult =
    | {
          type: 'approved';
          importRun: DashboardStructureImportRun;
      }
    | { type: 'invalid-input'; message: string }
    | { type: 'plan-digest-mismatch' }
    | { type: 'not-approvable'; status: string }
    | DashboardStructureErrorResult;

export type DashboardStructureRecoveryInput = {
    guildId: string;
    importRunId: string;
};

export type DashboardStructureRecoveryResult =
    | {
          type: 'recovery-plan-created';
          importRun: DashboardStructureImportRun;
      }
    | { type: 'invalid-input'; message: string }
    | { type: 'mapping-required'; conflicts: DashboardStructureRoleMappingConflict[] }
    | { type: 'not-recoverable'; status: string }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
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

    const runStateResults = await Promise.all(
        runsResult.value.map(async (run) => {
            const [preflight, execution] = await Promise.all([
                findLatestStructureImportPreflight(database.db, { guildId: context.guild.id, runId: run.id }),
                findLatestStructureImportExecution(database.db, { guildId: context.guild.id, runId: run.id }),
            ]);
            return { run, preflight, execution };
        })
    );
    if (runStateResults.some(({ preflight, execution }) => preflight.isErr() || execution.isErr())) {
        return { type: 'database-error' };
    }

    return {
        type: 'settings',
        backups: backupsResult.value.backups.map(toDashboardBackupSummary),
        ...(backupsResult.value.nextCursor ? { backupNextCursor: backupsResult.value.nextCursor } : {}),
        backupSettings: toDashboardBackupSettings(backupSettingsResult.value),
        importRuns: runStateResults.map(({ run, preflight, execution }) => {
            const executionRecord = execution.isOk() ? execution.value : null;
            const recoveryAvailable =
                executionRecord !== null &&
                ['partially_applied', 'needs_reconciliation', 'outcome_unknown'].includes(executionRecord.status);
            return {
                ...toDashboardImportRun(run),
                ...(preflight.isOk() && preflight.value ? { preflight: toDashboardPreflight(preflight.value) } : {}),
                ...(executionRecord ? { execution: toDashboardExecution(executionRecord) } : {}),
                ...(recoveryAvailable ? { recoveryAvailable: true } : {}),
            };
        }),
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
    const backupResult = await findStructureBackupByGuildId(database.db, {
        backupId,
        guildId: context.guild.id,
    });
    if (backupResult.isErr()) return mapRepositoryError(backupResult.error);
    if (backupResult.value.source === structureBackupSources.restorePoint) {
        return { type: 'restore-point-protected' };
    }
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
    const planResult = tryDiffDashboardStructureSnapshot(current, requestedResult.snapshot, { policy: 'synchronize' });
    if (planResult.type !== 'valid') return planResult;
    const plan = planResult.plan;
    const runResult = await persistStructureImportPlan(context, plan, requestedResult.snapshot, {
        policy: 'synchronize',
        audit: (importRunId) =>
            createStructureAuditPayload(context, structureAuditActions.backupImportCreated, backupResult.value.id, {
                actionCount: plan.actions.length,
                importRunId,
            }),
        source: 'backup',
        sourceBackupId: backupResult.value.id,
    });

    if (runResult.type !== 'plan-created') return runResult;

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

export async function createDashboardStructureImportPlan(
    request: Request,
    input: DashboardStructurePlanInput
): Promise<DashboardStructurePlanResult> {
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
    if (!isDashboardStructurePolicy(input.policy)) {
        return { type: 'invalid-input', message: 'Choose how this blueprint should own the target server.' };
    }
    const policy = input.policy;
    const planResult = tryDiffDashboardStructureSnapshot(current, requestedResult.snapshot, {
        policy,
        roleMappings: input.roleMappings,
        categoryMappings: input.categoryMappings,
        channelMappings: input.channelMappings,
    });
    if (planResult.type !== 'valid') return planResult;
    const plan = planResult.plan;
    const runResult = await persistStructureImportPlan(context, plan, requestedResult.snapshot, {
        audit: (importRunId) =>
            createStructureAuditPayload(context, structureAuditActions.importPlanCreated, importRunId, {
                actionCount: plan.actions.length,
                createCount: plan.summary.creates,
                updateCount: plan.summary.updates,
                deleteCount: plan.summary.deletes,
                policy,
            }),
        policy,
        roleMappings: input.roleMappings,
        categoryMappings: input.categoryMappings,
        channelMappings: input.channelMappings,
    });

    if (runResult.type !== 'plan-created') return runResult;

    return runResult;
}

export async function approveDashboardStructurePlan(
    request: Request,
    input: DashboardStructureApprovalInput
): Promise<DashboardStructureApprovalResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const importRunId = input.importRunId.trim();

    if (!importRunId) {
        return { type: 'invalid-input', message: 'Choose a deployment plan to approve.' };
    }

    const database = await getWebDb();
    const importRunResult = await findStructureImportRunWithActionsByGuildId(database.db, {
        guildId: context.guild.id,
        runId: importRunId,
    });

    if (importRunResult.isErr()) return mapRepositoryError(importRunResult.error);

    if (importRunResult.value.status !== structureImportRunStatuses.reviewReady) {
        return { type: 'not-approvable', status: importRunResult.value.status };
    }
    const planDigest = importRunResult.value.planDigest;
    if (!planDigest || input.planDigest !== planDigest) return { type: 'plan-digest-mismatch' };
    const blockers = Array.isArray(importRunResult.value.plan.blockers) ? importRunResult.value.plan.blockers : [];
    if (blockers.length > 0) {
        return { type: 'invalid-input', message: 'Resolve every blocked blueprint decision before approval.' };
    }

    const summary = summarizeActions(importRunResult.value.actions);
    const approvedAt = new Date();
    const approvalResult = await approveStructureImportPlan(database.db, {
        runId: importRunId,
        planDigest,
        approvedByUserId: context.actor.actorUserId,
        approvedAt,
        deleteSetDigest: null,
        destructiveActionCount: null,
        destructiveApprovedAt: null,
        destructivePreflightDigest: null,
        audit: createStructureAuditPayload(context, structureAuditActions.importPlanApproved, importRunId, {
            actionCount: importRunResult.value.actions.length,
            createCount: summary.creates,
            updateCount: summary.updates,
            deleteCount: summary.deletes,
        }),
    });

    if (approvalResult.isErr()) return mapRepositoryError(approvalResult.error);

    const approvedRun = toDashboardImportRun({
        ...importRunResult.value,
        status: structureImportRunStatuses.approved,
        updatedAt: approvedAt,
        actions: importRunResult.value.actions,
    });

    return {
        type: 'approved',
        importRun: approvedRun,
    };
}

export async function createDashboardStructureRecoveryPlan(
    request: Request,
    input: DashboardStructureRecoveryInput
): Promise<DashboardStructureRecoveryResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const importRunId = input.importRunId.trim();
    if (!importRunId) return { type: 'invalid-input', message: 'Choose a deployment that needs reconciliation.' };

    const recoverySource = await loadDashboardStructureRecoverySource(context.guild.id, importRunId);
    if (recoverySource.type !== 'source') return recoverySource;
    const sourceRun = recoverySource.run;
    const sourceExecution = recoverySource.execution;
    const requestedSnapshot = readRequestedSnapshot(sourceRun.plan);
    if (!requestedSnapshot) return { type: 'invalid-input', message: 'This run has no source snapshot.' };
    const botToken = loadWebConfig().fluxerBotToken;
    if (!botToken) return { type: 'bot-token-missing' };
    const currentResult = await readFluxerBotGuildStructure({ botToken, guildId: context.guild.id });
    if (currentResult.isErr()) return { type: 'structure-read-failed' };
    if (!readPolicy(sourceRun.plan)) {
        return { type: 'invalid-input', message: 'This run is not a current Server Blueprint plan.' };
    }
    const policy: DashboardStructurePolicy = 'synchronize';
    const roleMappings = readPersistedRoleMappings(sourceRun.plan);
    const categoryMappings = readPersistedCategoryMappings(sourceRun.plan);
    const channelMappings = readPersistedChannelMappings(sourceRun.plan);
    const planResult = tryDiffDashboardStructureSnapshot(
        toDashboardStructureSnapshot(currentResult.value),
        requestedSnapshot,
        { policy, roleMappings, categoryMappings, channelMappings }
    );
    if (planResult.type !== 'valid') return planResult;
    const recoveryResult = await persistStructureImportPlan(context, planResult.plan, requestedSnapshot, {
        policy,
        roleMappings,
        categoryMappings,
        channelMappings,
        planMetadata: createDashboardStructureRecoveryMetadata(sourceRun.id, sourceExecution.id),
        source: 'dashboard-recovery-plan',
        ...(sourceRun.sourceBackupId ? { sourceBackupId: sourceRun.sourceBackupId } : {}),
    });
    return recoveryResult.type === 'plan-created'
        ? { type: 'recovery-plan-created', importRun: recoveryResult.importRun }
        : recoveryResult;
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

async function persistStructureImportPlan(
    context: AuthorizedStructureContext,
    plan: DashboardStructurePlan,
    requestedSnapshot: DashboardStructureSnapshot,
    options: {
        audit?: (importRunId: string) => StructureAuditPayload;
        policy: DashboardStructurePolicy;
        planMetadata?: Record<string, unknown>;
        roleMappings?: Record<string, string>;
        categoryMappings?: Record<string, string>;
        channelMappings?: Record<string, string>;
        source?: string;
        sourceBackupId?: string;
    }
): Promise<DashboardStructurePlanResult> {
    const database = await getWebDb();
    const requestedSnapshotStoredAt = new Date().toISOString();
    const { planDigest, deleteActionCount, deleteSetDigest, requestedSnapshotDigest } =
        createDashboardStructurePlanDigests(plan, requestedSnapshot);
    const reviewDecisions = materializeDashboardStructureReviewDecisions(plan, requestedSnapshot);
    const runResult = await createStructureImportRun(database.db, {
        guildId: context.guild.id,
        createdByUserId: context.actor.actorUserId,
        planVersion: 3,
        policy: options.policy,
        planDigest,
        deleteActionCount,
        ...(deleteSetDigest ? { deleteSetDigest } : {}),
        requestedSnapshotDigest,
        plan: toJsonRecord({
            summary: plan.summary,
            executionActionCount: plan.executionActions.length,
            executionActions: plan.executionActions,
            knownTargetKinds: plan.knownTargetKinds,
            sourceTargetMap: plan.sourceTargetMap,
            roleProjection: plan.roleProjection,
            ...(options.roleMappings && Object.keys(options.roleMappings).length > 0
                ? { roleMappings: options.roleMappings }
                : {}),
            ...(options.categoryMappings && Object.keys(options.categoryMappings).length > 0
                ? { categoryMappings: options.categoryMappings }
                : {}),
            ...(options.channelMappings && Object.keys(options.channelMappings).length > 0
                ? { channelMappings: options.channelMappings }
                : {}),
            requestedGuildId: requestedSnapshot.guildId ?? null,
            requestedExportedAt: requestedSnapshot.exportedAt ?? null,
            requestedSnapshot,
            requestedSnapshotStoredAt,
            requestedSnapshotVersion: 1,
            source: options.source ?? 'dashboard-json',
            ...(options.planMetadata ?? {}),
            planVersion: 3,
            policy: options.policy,
            planDigest,
            decisionSummary: summarizeDashboardStructureReviewDecisions(reviewDecisions),
            blockers: plan.blockers,
            projectedSnapshot: plan.projectedSnapshot,
            fingerprintInput: plan.fingerprintInput,
        }),
        ...(options.sourceBackupId ? { sourceBackupId: options.sourceBackupId } : {}),
    });

    if (runResult.isErr()) return { type: 'database-error' };

    const decisionRecords = await recordDashboardStructureReviewDecisions(runResult.value.id, reviewDecisions);
    if (decisionRecords === 'database-error') {
        await markStructureImportRunActionWriteFailed(runResult.value.id);
        return { type: 'database-error' };
    }

    const actionRecords = await recordActionBatches(
        runResult.value.id,
        plan.executionActions.map((action, index) => ({
            actionType: action.actionType,
            targetType: action.targetType,
            ...(action.targetId ? { targetId: action.targetId } : {}),
            sequence: index,
            details: toJsonRecord(action.details),
        }))
    );

    if (actionRecords === 'database-error') {
        await markStructureImportRunActionWriteFailed(runResult.value.id);
        return { type: 'database-error' };
    }

    const updatedRunResult = await transitionStructureImportPlanState(database.db, {
        audit: options.audit?.(runResult.value.id),
        runId: runResult.value.id,
        expectedStatus: structureImportRunStatuses.building,
        now: new Date(),
        status: structureImportRunStatuses.reviewReady,
    });

    if (updatedRunResult.isErr()) return { type: 'database-error' };

    return {
        type: 'plan-created',
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

async function markStructureImportRunActionWriteFailed(runId: string): Promise<void> {
    const database = await getWebDb();

    await transitionStructureImportPlanState(database.db, {
        runId,
        expectedStatus: structureImportRunStatuses.building,
        now: new Date(),
        status: structureImportRunStatuses.stale,
    });
}

function parseDashboardStructureSnapshot(
    backupJson: string
): { type: 'valid'; snapshot: DashboardStructureSnapshot } | { type: 'invalid-input'; message: string } {
    if (!isFluxerGuildStructureSnapshotJsonWithinByteLimit(backupJson)) {
        return {
            type: 'invalid-input',
            message: `Server blueprint JSON cannot exceed ${String(FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxJsonBytes / 1024 / 1024)} MiB.`,
        };
    }

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
            if (field === 'position' || field === 'roleOrder' || field === 'channelOrder') {
                fieldSummary.positions += 1;
            }
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

function toDashboardImportRun(
    record: StructureImportRunRecord | StructureImportRunWithActionsRecord
): DashboardStructureImportRun {
    const actions = 'actions' in record ? record.actions : [];
    const summary = readPlanSummary(record.plan);
    const requestedSnapshot = readRequestedSnapshot(record.plan);
    const requestedSnapshotStoredAt = readRequestedSnapshotStoredAt(record.plan);
    const policy = readPolicy(record.plan);
    if (!policy || record.plan.planVersion !== 3) throw new Error('invalid-server-blueprint-v3-plan');
    const decisionSummary = readDecisionSummary(record.plan);
    const planDigest = typeof record.plan.planDigest === 'string' ? record.plan.planDigest : '';
    if (!planDigest) throw new Error('invalid-server-blueprint-v3-digest');
    const actionCount = summary.creates + summary.updates + summary.deletes;
    const executionActionCount = readExecutionActionCount(record.plan);

    return {
        id: record.id,
        status: record.status,
        ...(record.createdByUserId ? { createdByUserId: record.createdByUserId } : {}),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        summary,
        actionCount,
        executionActionCount,
        actions: shouldInlineImportActions(executionActionCount, actions) ? actions.map(toDashboardImportAction) : [],
        ...(requestedSnapshot ? { requestedSnapshot } : {}),
        ...(requestedSnapshot && requestedSnapshotStoredAt ? { requestedSnapshotStoredAt } : {}),
        policy,
        decisionSummary,
        decisions: [],
        planDigest,
        deleteActionCount: record.deleteActionCount,
        ...(record.deleteSetDigest ? { deleteSetDigest: record.deleteSetDigest } : {}),
    };
}

function toDashboardPreflight(
    record: StructureImportPreflightRecord
): DashboardStructurePersistedPreflight & { report: DashboardStructurePreflightReport } {
    const report = record.report as DashboardStructurePreflightReport;
    const blockerCount =
        report.summary.stale + report.summary.mappingRequired + report.summary.unsupported + report.summary.invalidPlan;
    return {
        checkedAt: record.checkedAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        digest: record.preflightDigest,
        status: record.status === 'ready' ? 'ready' : 'blocked',
        blockerCount,
        report,
    };
}

function toDashboardExecution(record: StructureImportExecutionRecord): DashboardStructureExecutionProgress {
    if (!dashboardStructureExecutionPhases.includes(record.phase)) {
        throw new Error('invalid-server-blueprint-execution-phase');
    }
    const phase = record.phase;
    return {
        id: record.id,
        protocolVersion: record.protocolVersion,
        status: record.status,
        phase,
        completedActions: record.appliedActions + record.failedActions + record.skippedActions,
        failedActions: record.failedActions,
        totalActions: record.totalActions,
        ...(record.currentActionLabel ? { currentActionLabel: record.currentActionLabel } : {}),
        ...(record.retryAt ? { retryAt: record.retryAt.toISOString() } : {}),
        ...(record.errorType ? { errorType: record.errorType } : {}),
        ...(record.restorePointBackupId ? { restorePointBackupId: record.restorePointBackupId } : {}),
        createdAt: record.createdAt.toISOString(),
        ...(record.startedAt ? { startedAt: record.startedAt.toISOString() } : {}),
        updatedAt: record.updatedAt.toISOString(),
        ...(record.completedAt ? { completedAt: record.completedAt.toISOString() } : {}),
    };
}

function shouldInlineImportActions(executionActionCount: number, actions: StructureImportActionRecord[]): boolean {
    return (
        actions.length > 0 &&
        actions.length === executionActionCount &&
        actions.length <= dashboardImportActionInlineLimit
    );
}

function readExecutionActionCount(plan: Record<string, unknown>): number {
    const count = plan.executionActionCount;
    if (!Number.isInteger(count) || typeof count !== 'number' || count < 0) {
        throw new Error('invalid-server-blueprint-v3-execution-count');
    }
    return count;
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

function readPolicy(plan: Record<string, unknown>): DashboardStructurePolicy | undefined {
    return isDashboardStructurePolicy(plan.policy) ? plan.policy : undefined;
}

function readDecisionSummary(plan: Record<string, unknown>): DashboardStructureDecisionSummary {
    if (!isObject(plan.decisionSummary)) throw new Error('invalid-server-blueprint-decision-summary');
    const summary = createEmptyDecisionSummary();
    for (const classification of Object.keys(summary) as Array<keyof DashboardStructureDecisionSummary>) {
        summary[classification] = readNonNegativeNumber(plan.decisionSummary[classification]);
    }
    return summary;
}

function tryDiffDashboardStructureSnapshot(
    current: DashboardStructureSnapshot,
    requested: DashboardStructureSnapshot,
    options: {
        policy: DashboardStructurePolicy;
        roleMappings?: Record<string, string>;
        categoryMappings?: Record<string, string>;
        channelMappings?: Record<string, string>;
    }
):
    | { type: 'valid'; plan: DashboardStructurePlan }
    | { type: 'invalid-input'; message: string }
    | { type: 'mapping-required'; conflicts: DashboardStructureRoleMappingConflict[] } {
    try {
        return { type: 'valid', plan: diffDashboardStructureSnapshot(current, requested, options) };
    } catch (error) {
        if (error instanceof DashboardStructureAmbiguousIdentityError) {
            return { type: 'mapping-required', conflicts: error.conflicts };
        }
        if (isObject(error) && error.code === 'invalid-identity-mapping' && typeof error.message === 'string') {
            return { type: 'invalid-input', message: error.message };
        }
        throw error;
    }
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

function toJsonRecord(value: unknown): DashboardStructureJsonRecord {
    return JSON.parse(JSON.stringify(value)) as DashboardStructureJsonRecord;
}

function readNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
