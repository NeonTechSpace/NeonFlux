import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    createStructureBackup,
    findStructureImportRunWithActionsByGuildId,
    structureAuditActions,
    structureBackupSources,
    structureBackupStatuses,
    structureImportActionStatuses,
    structureImportRunStatuses,
    updateStructureImportActionStatus,
    updateStructureImportRunStatus,
} from '@neonflux/db';
import type { StructureImportActionRecord } from '@neonflux/db';
import { applyFluxerBotGuildStructureActions, readFluxerBotGuildStructure } from '@neonflux/fluxer';

import { getWebDb } from './db.server.js';
import { orderDashboardStructureImportActions } from './dashboard-structure-action-order.js';
import {
    loadAuthorizedStructureContext,
    recordStructureAuditBestEffort,
} from './dashboard-structure-context.server.js';
import type {
    AuthorizedStructureContext,
    DashboardStructureErrorResult,
} from './dashboard-structure-context.server.js';
import { normalizeDashboardStructureSnapshot, toDashboardStructureSnapshot } from './dashboard-structure-diff.js';
import type { DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import { preflightDashboardStructureImportPlan } from './dashboard-structure-preflight.js';
import type {
    DashboardStructurePreflightInputAction,
    DashboardStructurePreflightReport,
} from './dashboard-structure-preflight.js';
import { toDashboardImportRun } from './dashboard-structure.server.js';
import type { DashboardStructureImportRun } from './dashboard-structure.server.js';

export type DashboardStructureApplyInput = {
    guildId: string;
    importRunId: string;
    confirmationText: string;
    destructiveConfirmationText?: string;
};

export type DashboardStructureApplyResult =
    | {
          type: 'applied';
          importRun: DashboardStructureImportRun;
          restorePointBackupId?: string;
      }
    | {
          type: 'failed';
          importRun: DashboardStructureImportRun;
          restorePointBackupId?: string;
      }
    | {
          type: 'preflight-blocked';
          report: DashboardStructurePreflightReport;
      }
    | { type: 'invalid-input'; message: string }
    | { type: 'confirmation-mismatch'; expectedText: string }
    | { type: 'destructive-confirmation-mismatch'; expectedText: string }
    | { type: 'not-applicable'; status: string }
    | { type: 'bot-token-missing' }
    | { type: 'restore-point-failed' }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

export async function applyDashboardStructureImportRun(
    request: Request,
    input: DashboardStructureApplyInput
): Promise<DashboardStructureApplyResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const importRunId = input.importRunId.trim();

    if (!importRunId) return { type: 'invalid-input', message: 'Choose a confirmed import dry-run to apply.' };

    const expectedText = getStructureImportApplyText(importRunId);

    if (input.confirmationText.trim() !== expectedText) {
        return { type: 'confirmation-mismatch', expectedText };
    }

    const database = await getWebDb();
    const importRunResult = await findStructureImportRunWithActionsByGuildId(database.db, {
        guildId: context.guild.id,
        runId: importRunId,
    });

    if (importRunResult.isErr()) return mapRepositoryError(importRunResult.error);
    if (importRunResult.value.status !== structureImportRunStatuses.confirmed) {
        return { type: 'not-applicable', status: importRunResult.value.status };
    }

    const deleteActionCount = countDeleteActions(importRunResult.value.actions);

    if (deleteActionCount > 0) {
        const expectedDeleteText = getStructureImportDeleteApprovalText(importRunId, deleteActionCount);

        if ((input.destructiveConfirmationText ?? '').trim() !== expectedDeleteText) {
            return { type: 'destructive-confirmation-mismatch', expectedText: expectedDeleteText };
        }
    }

    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) return { type: 'bot-token-missing' };

    const preflightResult = await runApplyPreflight(botToken, context.guild.id, importRunResult.value.actions, {
        allowDestructiveDeletes: deleteActionCount > 0,
        idMap: readApplySourceTargetMap(importRunResult.value.plan),
        sourceGuildId: readRequestedGuildId(importRunResult.value.plan),
    });

    if (preflightResult.type !== 'ready') return preflightResult;

    const riskSummary = summarizeRestorePointRisk(importRunResult.value.actions);
    const restorePointResult =
        riskSummary.riskyActionCount > 0
            ? await createRestorePointBackup(context, preflightResult.snapshot, importRunId, riskSummary)
            : undefined;

    if (restorePointResult === 'database-error') return { type: 'restore-point-failed' };

    const applyingResult = await updateStructureImportRunStatus(database.db, {
        runId: importRunId,
        status: structureImportRunStatuses.applying,
    });

    if (applyingResult.isErr()) return mapRunStatusError(applyingResult.error);

    const applyResult = await applyReadyActions(
        botToken,
        context.guild.id,
        importRunResult.value.actions,
        readRequestedGuildId(importRunResult.value.plan),
        readApplySourceTargetMap(importRunResult.value.plan),
        readImportMode(importRunResult.value.plan),
        readRequestedSnapshot(importRunResult.value.plan)
    );
    const finalStatus =
        applyResult.actions.every((result) => result.status === structureImportActionStatuses.applied) &&
        applyResult.roleOrderStatus !== 'failed'
            ? structureImportRunStatuses.applied
            : structureImportRunStatuses.failed;
    const finalRunResult = await updateStructureImportRunStatus(database.db, {
        runId: importRunId,
        status: finalStatus,
        plan: {
            ...applyingResult.value.plan,
            applySummary: {
                applied: applyResult.actions.filter((result) => result.status === structureImportActionStatuses.applied)
                    .length,
                failed: applyResult.actions.filter((result) => result.status === structureImportActionStatuses.failed)
                    .length,
                sourceTargetMap: applyResult.idMap,
                ...(applyResult.roleOrderStatus ? { roleOrderStatus: applyResult.roleOrderStatus } : {}),
                ...(applyResult.roleOrderErrorType ? { roleOrderErrorType: applyResult.roleOrderErrorType } : {}),
                ...(restorePointResult ? { restorePointBackupId: restorePointResult.id } : {}),
            },
        },
    });

    if (finalRunResult.isErr()) return mapRunStatusError(finalRunResult.error);

    const refreshedRunResult = await findStructureImportRunWithActionsByGuildId(database.db, {
        guildId: context.guild.id,
        runId: importRunId,
    });

    if (refreshedRunResult.isErr()) return mapRepositoryError(refreshedRunResult.error);

    const importRun = toDashboardImportRun(refreshedRunResult.value);
    await recordStructureAuditBestEffort(
        context,
        finalStatus === structureImportRunStatuses.applied
            ? structureAuditActions.importApplied
            : structureAuditActions.importFailed,
        importRunId,
        {
            actionCount: importRun.actionCount,
            appliedCount: applyResult.actions.filter(
                (result) => result.status === structureImportActionStatuses.applied
            ).length,
            failedCount: applyResult.actions.filter((result) => result.status === structureImportActionStatuses.failed)
                .length,
            mappedSourceCount: Object.keys(applyResult.idMap).length,
            deleteCount: deleteActionCount,
            ...(restorePointResult ? { restorePointBackupId: restorePointResult.id } : {}),
        }
    ).catch(() => undefined);

    return finalStatus === structureImportRunStatuses.applied
        ? { type: 'applied', importRun, ...(restorePointResult ? { restorePointBackupId: restorePointResult.id } : {}) }
        : { type: 'failed', importRun, ...(restorePointResult ? { restorePointBackupId: restorePointResult.id } : {}) };
}

export function getStructureImportApplyText(importRunId: string): string {
    return `APPLY ${importRunId.trim()}`;
}

export function getStructureImportDeleteApprovalText(importRunId: string, deleteActionCount: number): string {
    return `DELETE ${importRunId.trim()} ${deleteActionCount}`;
}

async function runApplyPreflight(
    botToken: string,
    guildId: string,
    actions: StructureImportActionRecord[],
    options: { allowDestructiveDeletes?: boolean; idMap?: Record<string, string>; sourceGuildId?: string } = {}
): Promise<
    | { type: 'ready'; snapshot: DashboardStructureSnapshot }
    | { type: 'structure-read-failed' }
    | { type: 'preflight-blocked'; report: DashboardStructurePreflightReport }
> {
    const currentResult = await readFluxerBotGuildStructure({ botToken, guildId });

    if (currentResult.isErr()) return { type: 'structure-read-failed' };

    const snapshot = toDashboardStructureSnapshot(currentResult.value);
    const report = preflightDashboardStructureImportPlan(snapshot, actions.map(toPreflightAction), options);

    if (report.summary.ready !== report.summary.total) {
        return { type: 'preflight-blocked', report };
    }

    return { type: 'ready', snapshot };
}

type RestorePointRiskSummary = {
    deleteCount: number;
    permissionRiskCount: number;
    riskyActionCount: number;
};

async function createRestorePointBackup(
    context: AuthorizedStructureContext,
    snapshot: DashboardStructureSnapshot,
    importRunId: string,
    riskSummary: RestorePointRiskSummary
): Promise<{ id: string } | 'database-error'> {
    const database = await getWebDb();
    const result = await createStructureBackup(database.db, {
        audit: createStructureAuditPayload(context, structureAuditActions.backupRestorePointCreated, importRunId, {
            categoryCount: snapshot.categories.length,
            channelCount: snapshot.channels.length,
            deleteCount: riskSummary.deleteCount,
            permissionRiskCount: riskSummary.permissionRiskCount,
            riskyActionCount: riskSummary.riskyActionCount,
            roleCount: snapshot.roles.length,
            source: structureBackupSources.restorePoint,
        }),
        guildId: context.guild.id,
        createdByUserId: context.actor.actorUserId,
        serverName: context.guild.name,
        source: structureBackupSources.restorePoint,
        status: structureBackupStatuses.succeeded,
        structure: toJsonRecord(snapshot),
        roleCount: snapshot.roles.length,
        categoryCount: snapshot.categories.length,
        channelCount: snapshot.channels.length,
    }).catch(() => undefined);

    if (!result || result.isErr()) return 'database-error';

    return { id: result.value.id };
}

function summarizeRestorePointRisk(actions: StructureImportActionRecord[]): RestorePointRiskSummary {
    const deleteCount = countDeleteActions(actions);
    const permissionRiskCount = actions.filter(isPermissionRiskAction).length;

    return {
        deleteCount,
        permissionRiskCount,
        riskyActionCount: deleteCount + permissionRiskCount,
    };
}

function isPermissionRiskAction(action: StructureImportActionRecord): boolean {
    if (action.actionType !== 'update') return false;

    const details = toJsonRecord(action.details);
    const changes = readChanges(details);

    return changes.some((change) => {
        if (action.targetType === 'role') return change.field === 'permissions';
        if (action.targetType === 'category' || action.targetType === 'channel') {
            return change.field === 'permissionOverwrites';
        }

        return false;
    });
}

async function applyReadyActions(
    botToken: string,
    guildId: string,
    actions: StructureImportActionRecord[],
    sourceGuildId: string | undefined,
    initialIdMap: Record<string, string>,
    importMode: 'merge' | 'replace',
    requestedSnapshot: DashboardStructureSnapshot | undefined
) {
    const database = await getWebDb();
    const results: Array<{ actionId: string; status: string }> = [];
    const orderedActions = orderDashboardStructureImportActions(actions, importMode);
    const sourceTargetMap = {
        ...initialIdMap,
        ...readMatchedRoleSourceTargetMap(actions),
    };
    const applyResult = await applyFluxerBotGuildStructureActions({
        botToken,
        guildId,
        actions: orderedActions.map((action) => {
            const details = toJsonRecord(action.details);

            return {
                id: action.id,
                actionType: action.actionType,
                targetType: action.targetType,
                targetId: action.targetId ?? '',
                changes: readChanges(details),
                after: details.after,
            };
        }),
        ...(sourceGuildId ? { sourceGuildId } : {}),
        ...(Object.keys(sourceTargetMap).length > 0 ? { idMap: sourceTargetMap } : {}),
        ...(requestedSnapshot ? { roleOrder: toRequestedRoleOrder(requestedSnapshot) } : {}),
        stopAfterDeleteFailures: importMode === 'replace',
    });

    if (applyResult.isErr()) {
        for (const action of actions) {
            await updateStructureImportActionStatus(database.db, {
                actionId: action.id,
                status: structureImportActionStatuses.failed,
                details: {
                    ...toJsonRecord(action.details),
                    appliedAt: new Date().toISOString(),
                    errorType: applyResult.error.type,
                },
            });
        }

        return {
            actions: actions.map((action) => ({ actionId: action.id, status: structureImportActionStatuses.failed })),
            idMap: sourceTargetMap,
        };
    }

    const resultActionIds = new Set<string>();

    for (const result of applyResult.value.actions) {
        const action = actions.find((candidate) => candidate.id === result.id);
        if (!action) continue;
        resultActionIds.add(action.id);

        const details = toJsonRecord(action.details);
        const status =
            result.status === 'applied' ? structureImportActionStatuses.applied : structureImportActionStatuses.failed;
        const updatedDetails = {
            ...details,
            appliedAt: new Date().toISOString(),
            ...(action.targetId && result.createdId
                ? {
                      sourceId: action.targetId,
                      createdId: result.createdId,
                  }
                : {}),
            ...(result.errorType ? { errorType: result.errorType } : {}),
            ...(result.errorCauseType ? { errorCauseType: result.errorCauseType } : {}),
        };

        const statusResult = await updateStructureImportActionStatus(database.db, {
            actionId: action.id,
            status,
            details: updatedDetails,
        });

        if (statusResult.isErr()) {
            results.push({ actionId: action.id, status: structureImportActionStatuses.failed });
            continue;
        }

        results.push({ actionId: action.id, status });
    }

    for (const action of actions) {
        if (resultActionIds.has(action.id)) continue;

        await updateStructureImportActionStatus(database.db, {
            actionId: action.id,
            status: structureImportActionStatuses.failed,
            details: {
                ...toJsonRecord(action.details),
                appliedAt: new Date().toISOString(),
                errorType: 'apply-result-missing',
            },
        });

        results.push({
            actionId: action.id,
            status: structureImportActionStatuses.failed,
        });
    }

    return {
        actions: results,
        idMap: applyResult.value.idMap,
        ...(applyResult.value.roleOrder
            ? {
                  roleOrderStatus: applyResult.value.roleOrder.status,
                  ...(applyResult.value.roleOrder.errorType
                      ? { roleOrderErrorType: applyResult.value.roleOrder.errorType }
                      : {}),
              }
            : {}),
    };
}

function toPreflightAction(action: StructureImportActionRecord): DashboardStructurePreflightInputAction {
    const details = toJsonRecord(action.details);
    const label = typeof details.label === 'string' ? details.label : undefined;

    return {
        id: action.id,
        actionType: action.actionType,
        targetType: action.targetType,
        ...(action.targetId ? { targetId: action.targetId } : {}),
        ...(label ? { label } : {}),
        details,
    };
}

function readChanges(details: Record<string, unknown>): Array<{ field: string; before?: unknown; after: unknown }> {
    const changes = details.changes;

    if (!Array.isArray(changes)) return [];

    return changes
        .filter(
            (change): change is { field: string; before?: unknown; after: unknown } =>
                isObject(change) && typeof change.field === 'string'
        )
        .map((change) => ({
            field: change.field,
            ...(change.before !== undefined ? { before: change.before } : {}),
            after: change.after,
        }));
}

function readRequestedGuildId(plan: Record<string, unknown>): string | undefined {
    return typeof plan.requestedGuildId === 'string' && plan.requestedGuildId.trim()
        ? plan.requestedGuildId.trim()
        : undefined;
}

function readApplySourceTargetMap(plan: Record<string, unknown>): Record<string, string> {
    const directMap = isObject(plan.sourceTargetMap) ? plan.sourceTargetMap : undefined;
    const applySummary = isObject(plan.applySummary) ? plan.applySummary : undefined;
    const summaryMap =
        applySummary && isObject(applySummary.sourceTargetMap) ? applySummary.sourceTargetMap : undefined;
    const source = directMap ?? summaryMap ?? {};

    return Object.fromEntries(
        Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
}

function readImportMode(plan: Record<string, unknown>): 'merge' | 'replace' {
    return plan.importMode === 'replace' ? 'replace' : 'merge';
}

function readRequestedSnapshot(plan: Record<string, unknown>): DashboardStructureSnapshot | undefined {
    const normalized = normalizeDashboardStructureSnapshot(plan.requestedSnapshot);

    return normalized.type === 'valid' ? normalized.snapshot : undefined;
}

function readMatchedRoleSourceTargetMap(actions: StructureImportActionRecord[]): Record<string, string> {
    return Object.fromEntries(
        actions.flatMap((action): Array<[string, string]> => {
            if (action.actionType !== 'update' || action.targetType !== 'role' || !action.targetId) return [];

            const details = toJsonRecord(action.details);
            const sourceId = typeof details.sourceId === 'string' ? details.sourceId.trim() : '';

            return sourceId ? [[sourceId, action.targetId]] : [];
        })
    );
}

function toRequestedRoleOrder(snapshot: DashboardStructureSnapshot) {
    return snapshot.roles.flatMap((role) => {
        if (role.protected || role.protectionReason || role.name === '@everyone' || role.position <= 0) return [];

        return [
            {
                sourceId: role.id,
                position: role.position,
                ...(role.hierarchyRank !== undefined ? { hierarchyRank: role.hierarchyRank } : {}),
            },
        ];
    });
}

function mapRunStatusError(error: { type: string; from?: string }): DashboardStructureApplyResult {
    if (error.type === 'invalid-status-transition') {
        return { type: 'not-applicable', status: error.from ?? 'unknown' };
    }

    return mapRepositoryError(error);
}

function mapRepositoryError(error: { type: string }): DashboardStructureErrorResult {
    return error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
}

function createStructureAuditPayload(
    context: AuthorizedStructureContext,
    action: string,
    targetId: string | undefined,
    metadata: Record<string, unknown>
) {
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

function countDeleteActions(actions: StructureImportActionRecord[]): number {
    return actions.filter((action) => action.actionType === 'delete').length;
}

function toJsonRecord(value: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
