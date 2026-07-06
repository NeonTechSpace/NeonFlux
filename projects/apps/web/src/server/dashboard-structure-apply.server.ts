import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    findStructureImportRunWithActionsByGuildId,
    structureAuditActions,
    structureImportActionStatuses,
    structureImportRunStatuses,
    updateStructureImportActionStatus,
    updateStructureImportRunStatus,
} from '@neonflux/db';
import type { StructureImportActionRecord } from '@neonflux/db';
import { applyFluxerBotGuildStructureActions, readFluxerBotGuildStructure } from '@neonflux/fluxer';

import { getWebDb } from './db.server.js';
import {
    loadAuthorizedStructureContext,
    recordStructureAuditBestEffort,
} from './dashboard-structure-context.server.js';
import type { DashboardStructureErrorResult } from './dashboard-structure-context.server.js';
import { toDashboardStructureSnapshot } from './dashboard-structure-diff.js';
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
      }
    | {
          type: 'failed';
          importRun: DashboardStructureImportRun;
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
        readApplySourceTargetMap(importRunResult.value.plan)
    );
    const finalStatus = applyResult.actions.every((result) => result.status === structureImportActionStatuses.applied)
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
        }
    ).catch(() => undefined);

    return finalStatus === structureImportRunStatuses.applied
        ? { type: 'applied', importRun }
        : { type: 'failed', importRun };
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
    | { type: 'ready' }
    | { type: 'structure-read-failed' }
    | { type: 'preflight-blocked'; report: DashboardStructurePreflightReport }
> {
    const currentResult = await readFluxerBotGuildStructure({ botToken, guildId });

    if (currentResult.isErr()) return { type: 'structure-read-failed' };

    const report = preflightDashboardStructureImportPlan(
        toDashboardStructureSnapshot(currentResult.value),
        actions.map(toPreflightAction),
        options
    );

    if (report.summary.ready !== report.summary.total) {
        return { type: 'preflight-blocked', report };
    }

    return { type: 'ready' };
}

async function applyReadyActions(
    botToken: string,
    guildId: string,
    actions: StructureImportActionRecord[],
    sourceGuildId: string | undefined,
    initialIdMap: Record<string, string>
) {
    const database = await getWebDb();
    const results: Array<{ actionId: string; status: string }> = [];
    const applyResult = await applyFluxerBotGuildStructureActions({
        botToken,
        guildId,
        actions: orderStructureActions(actions).map((action) => {
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
        ...(Object.keys(initialIdMap).length > 0 ? { idMap: initialIdMap } : {}),
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
            idMap: initialIdMap,
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

    return { actions: results, idMap: applyResult.value.idMap };
}

function orderStructureActions(actions: StructureImportActionRecord[]): StructureImportActionRecord[] {
    const actionTypeOrder = new Map([
        ['create', 0],
        ['update', 1],
        ['delete', 2],
    ]);
    const createTargetOrder = new Map([
        ['role', 0],
        ['category', 1],
        ['channel', 2],
    ]);
    const defaultTargetOrder = new Map([
        ['category', 0],
        ['channel', 1],
        ['role', 2],
    ]);
    const deleteTargetOrder = new Map([
        ['channel', 0],
        ['category', 1],
        ['role', 2],
    ]);

    return [...actions].sort(
        (left, right) =>
            (actionTypeOrder.get(left.actionType) ?? 99) - (actionTypeOrder.get(right.actionType) ?? 99) ||
            readTargetOrder(left, createTargetOrder, defaultTargetOrder, deleteTargetOrder) -
                readTargetOrder(right, createTargetOrder, defaultTargetOrder, deleteTargetOrder)
    );
}

function readTargetOrder(
    action: StructureImportActionRecord,
    createTargetOrder: ReadonlyMap<string, number>,
    defaultTargetOrder: ReadonlyMap<string, number>,
    deleteTargetOrder: ReadonlyMap<string, number>
): number {
    if (action.actionType === 'create') return createTargetOrder.get(action.targetType) ?? 99;
    if (action.actionType === 'delete') return deleteTargetOrder.get(action.targetType) ?? 99;

    return defaultTargetOrder.get(action.targetType) ?? 99;
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

function mapRunStatusError(error: { type: string; from?: string }): DashboardStructureApplyResult {
    if (error.type === 'invalid-status-transition') {
        return { type: 'not-applicable', status: error.from ?? 'unknown' };
    }

    return mapRepositoryError(error);
}

function mapRepositoryError(error: { type: string }): DashboardStructureErrorResult {
    return error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
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
