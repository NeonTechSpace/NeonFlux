import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    createStructureExportSnapshot,
    createStructureImportRun,
    findStructureImportRunByGuildId,
    findStructureObservedEventStateByGuildId,
    listStructureExportSnapshotsByGuildId,
    listStructureImportRunsByGuildId,
    recordStructureImportAction,
    updateStructureImportRunStatus,
} from '@neonflux/db';
import type {
    StructureExportSnapshotRecord,
    StructureImportActionRecord,
    StructureImportRunWithActionsRecord,
    StructureObservedEventStateRecord,
} from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';

import { getWebDatabaseClient } from './database.server.js';
import { loadAuthorizedStructureContext, recordStructureAudit } from './dashboard-structure-context.server.js';
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

export type DashboardStructureExportSummary = {
    id: string;
    source: string;
    createdByUserId?: string;
    createdAt: string;
    roleCount: number;
    categoryCount: number;
    channelCount: number;
};

export type DashboardStructureJsonValue =
    | string
    | number
    | boolean
    | null
    | DashboardStructureJsonValue[]
    | { [key: string]: DashboardStructureJsonValue };

export type DashboardStructureJsonRecord = {
    [key: string]: DashboardStructureJsonValue;
};

export type DashboardStructureImportAction = {
    id: string;
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
    actions: DashboardStructureImportAction[];
};

export type DashboardStructureObservedState = {
    observedChangeCount: number;
    lastEventType?: string;
    lastTargetType?: string;
    lastTargetId?: string;
    lastObservedAt?: string;
};

export type DashboardStructureSettingsResult =
    | {
          type: 'settings';
          exports: DashboardStructureExportSummary[];
          importRuns: DashboardStructureImportRun[];
          observedState: DashboardStructureObservedState;
      }
    | DashboardStructureErrorResult;

export type DashboardStructureExportResult =
    | {
          type: 'exported';
          exportSnapshot: DashboardStructureExportSummary;
          snapshotJson: string;
      }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
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
    snapshotJson: string;
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

export async function loadDashboardStructureSettings(
    request: Request,
    guildId: string
): Promise<DashboardStructureSettingsResult> {
    const context = await loadAuthorizedStructureContext(request, guildId);

    if (context.type !== 'authorized') return context;

    const database = getWebDatabaseClient();
    const snapshotsResult = await listStructureExportSnapshotsByGuildId(database.db, {
        guildId: context.guild.id,
        limit: 20,
    });
    const runsResult = await listStructureImportRunsByGuildId(database.db, {
        guildId: context.guild.id,
        limit: 20,
    });
    const observedStateResult = await findStructureObservedEventStateByGuildId(database.db, {
        guildId: context.guild.id,
    });

    if (snapshotsResult.isErr() || runsResult.isErr() || observedStateResult.isErr()) return { type: 'database-error' };

    return {
        type: 'settings',
        exports: snapshotsResult.value.map(toDashboardExportSummary),
        importRuns: runsResult.value.map(toDashboardImportRun),
        observedState: toDashboardObservedState(observedStateResult.value),
    };
}

export async function exportDashboardStructure(
    request: Request,
    guildId: string
): Promise<DashboardStructureExportResult> {
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
    const database = getWebDatabaseClient();
    const snapshotResult = await createStructureExportSnapshot(database.db, {
        guildId: context.guild.id,
        createdByUserId: context.actor.actorUserId,
        source: 'dashboard',
        snapshot: toJsonRecord(snapshot),
    });

    if (snapshotResult.isErr()) return { type: 'database-error' };

    const auditResult = await recordStructureAudit(context, 'structure.exported', snapshotResult.value.id, {
        roleCount: snapshot.roles.length,
        categoryCount: snapshot.categories.length,
        channelCount: snapshot.channels.length,
    });

    if (auditResult === 'database-error') return { type: 'database-error' };

    return {
        type: 'exported',
        exportSnapshot: toDashboardExportSummary(snapshotResult.value),
        snapshotJson: JSON.stringify(snapshot, null, 2),
    };
}

export async function createDashboardStructureImportDryRun(
    request: Request,
    input: DashboardStructureDryRunInput
): Promise<DashboardStructureDryRunResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const requestedResult = parseDashboardStructureSnapshot(input.snapshotJson);

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
    const runResult = await persistStructureImportDryRun(context, plan, requestedResult.snapshot);

    if (runResult.type !== 'dry-run-created') return runResult;

    const auditResult = await recordStructureAudit(
        context,
        'structure.import_dry_run_created',
        runResult.importRun.id,
        {
            actionCount: runResult.importRun.actions.length,
            createCount: runResult.importRun.summary.creates,
            updateCount: runResult.importRun.summary.updates,
            deleteCount: runResult.importRun.summary.deletes,
        }
    );

    if (auditResult === 'database-error') return { type: 'database-error' };

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

    const database = getWebDatabaseClient();
    const importRunResult = await findStructureImportRunByGuildId(database.db, {
        guildId: context.guild.id,
        runId: importRunId,
    });

    if (importRunResult.isErr()) return mapRepositoryError(importRunResult.error);

    if (importRunResult.value.status !== 'dry_run_complete') {
        return { type: 'not-confirmable', status: importRunResult.value.status };
    }

    const confirmedResult = await updateStructureImportRunStatus(database.db, {
        runId: importRunId,
        status: 'confirmed',
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
    const auditResult = await recordStructureAudit(context, 'structure.import_confirmed', importRunId, {
        actionCount: confirmedRun.actions.length,
        createCount: confirmedRun.summary.creates,
        updateCount: confirmedRun.summary.updates,
        deleteCount: confirmedRun.summary.deletes,
    });

    if (auditResult === 'database-error') return { type: 'database-error' };

    return {
        type: 'confirmed',
        importRun: confirmedRun,
    };
}

async function persistStructureImportDryRun(
    context: AuthorizedStructureContext,
    plan: DashboardStructurePlan,
    requestedSnapshot: DashboardStructureSnapshot
): Promise<DashboardStructureDryRunResult> {
    const database = getWebDatabaseClient();
    const runResult = await createStructureImportRun(database.db, {
        guildId: context.guild.id,
        createdByUserId: context.actor.actorUserId,
        plan: toJsonRecord({
            summary: plan.summary,
            requestedGuildId: requestedSnapshot.guildId ?? null,
            requestedExportedAt: requestedSnapshot.exportedAt ?? null,
            source: 'dashboard-json',
        }),
    });

    if (runResult.isErr()) return { type: 'database-error' };

    const actionRecords: StructureImportActionRecord[] = [];

    for (const action of plan.actions) {
        const actionResult = await recordStructureImportAction(database.db, {
            runId: runResult.value.id,
            actionType: action.actionType,
            targetType: action.targetType,
            ...(action.targetId ? { targetId: action.targetId } : {}),
            status: 'dry_run',
            details: toJsonRecord(action.details),
        });

        if (actionResult.isErr()) return { type: 'database-error' };

        actionRecords.push(actionResult.value);
    }

    const updatedRunResult = await updateStructureImportRunStatus(database.db, {
        runId: runResult.value.id,
        status: 'dry_run_complete',
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

function parseDashboardStructureSnapshot(
    snapshotJson: string
): { type: 'valid'; snapshot: DashboardStructureSnapshot } | { type: 'invalid-input'; message: string } {
    const trimmedJson = snapshotJson.trim();

    if (!trimmedJson) return { type: 'invalid-input', message: 'Paste exported structure JSON first.' };

    try {
        const parsed = JSON.parse(trimmedJson) as unknown;
        const normalized = normalizeDashboardStructureSnapshot(parsed);

        if (normalized.type === 'invalid') {
            return { type: 'invalid-input', message: normalized.message };
        }

        return { type: 'valid', snapshot: normalized.snapshot };
    } catch {
        return { type: 'invalid-input', message: 'Structure JSON could not be parsed.' };
    }
}

function toDashboardExportSummary(record: StructureExportSnapshotRecord): DashboardStructureExportSummary {
    const counts = countSnapshotItems(record.snapshot);

    return {
        id: record.id,
        source: record.source,
        ...(record.createdByUserId ? { createdByUserId: record.createdByUserId } : {}),
        createdAt: record.createdAt.toISOString(),
        roleCount: counts.roles,
        categoryCount: counts.categories,
        channelCount: counts.channels,
    };
}

export function toDashboardImportRun(record: StructureImportRunWithActionsRecord): DashboardStructureImportRun {
    return {
        id: record.id,
        status: record.status,
        ...(record.createdByUserId ? { createdByUserId: record.createdByUserId } : {}),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        summary: readPlanSummary(record.plan),
        actions: record.actions.map(toDashboardImportAction),
    };
}

function toDashboardImportAction(record: StructureImportActionRecord): DashboardStructureImportAction {
    const details = toJsonRecord(record.details);
    const label = typeof details.label === 'string' ? details.label : undefined;

    return {
        id: record.id,
        actionType: record.actionType,
        targetType: record.targetType,
        ...(record.targetId ? { targetId: record.targetId } : {}),
        status: record.status,
        ...(label ? { label } : {}),
        details,
    };
}

function toDashboardObservedState(record: StructureObservedEventStateRecord): DashboardStructureObservedState {
    return {
        observedChangeCount: record.observedChangeCount,
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

function countSnapshotItems(snapshot: Record<string, unknown>) {
    return {
        roles: Array.isArray(snapshot.roles) ? snapshot.roles.length : 0,
        categories: Array.isArray(snapshot.categories) ? snapshot.categories.length : 0,
        channels: Array.isArray(snapshot.channels) ? snapshot.channels.length : 0,
    };
}

function mapRepositoryError(error: { type: string }): DashboardStructureErrorResult {
    return error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
}

export function getStructureImportConfirmationText(importRunId: string): string {
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
