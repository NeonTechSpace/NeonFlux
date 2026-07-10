import '@tanstack/react-start/server-only';

import { randomUUID } from 'node:crypto';

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
    completeDashboardStructureApplyAttempt,
    createDashboardStructureApplyAttempt,
    renewDashboardStructureApplyAttempt,
    runWithDashboardStructureApplyHeartbeat,
} from './dashboard-structure-apply-attempt.js';
import { orderDashboardStructureImportActions } from './dashboard-structure-action-order.js';
import {
    loadAuthorizedStructureContext,
    recordStructureAuditBestEffort,
} from './dashboard-structure-context.server.js';
import type { DashboardStructureErrorResult } from './dashboard-structure-context.server.js';
import { toDashboardStructureSnapshot } from './dashboard-structure-diff.js';
import type { DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import {
    createApplyRestorePoint,
    summarizeApplyRestorePointRisk,
} from './dashboard-structure-apply-restore-point.server.js';
import {
    readApplySourceTargetMap,
    readImportMode,
    readMatchedRoleSourceTargetMap,
    readPersistedRoleOrder,
    readRequestedGuildId,
    readStructureActionChanges,
} from './dashboard-structure-apply-plan.js';
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
        idMap: {
            ...readApplySourceTargetMap(importRunResult.value.plan),
            ...readMatchedRoleSourceTargetMap(importRunResult.value.actions),
        },
        sourceGuildId: readRequestedGuildId(importRunResult.value.plan),
    });

    if (preflightResult.type !== 'ready') return preflightResult;

    let applyAttempt = createDashboardStructureApplyAttempt({
        attemptId: randomUUID(),
        leaseOwner: randomUUID(),
        now: new Date(),
        roleOrderRequired: importRunResult.value.actions.some((action) => action.targetType === 'role-order'),
    });

    const applyingResult = await updateStructureImportRunStatus(database.db, {
        runId: importRunId,
        status: structureImportRunStatuses.applying,
        plan: {
            ...importRunResult.value.plan,
            applyAttempt,
        },
    });

    if (applyingResult.isErr()) return mapRunStatusError(applyingResult.error);

    const riskSummary = summarizeApplyRestorePointRisk(importRunResult.value.actions);
    const restorePointResult =
        riskSummary.riskyActionCount > 0
            ? await createApplyRestorePoint(context, preflightResult.snapshot, importRunId, riskSummary)
            : undefined;

    if (restorePointResult === 'database-error') {
        applyAttempt = completeDashboardStructureApplyAttempt(applyAttempt, {
            now: new Date(),
            outcome: 'failed',
        });
        await updateStructureImportRunStatus(database.db, {
            expectedApplyAttemptId: applyAttempt.attemptId,
            expectedApplyLeaseOwner: applyAttempt.leaseOwner,
            plan: { ...applyingResult.value.plan, applyAttempt },
            runId: importRunId,
            status: structureImportRunStatuses.failed,
        });
        return { type: 'restore-point-failed' };
    }

    const renewApplyLease = async (now: Date): Promise<boolean> => {
        applyAttempt = renewDashboardStructureApplyAttempt(applyAttempt, now);
        const renewalResult = await updateStructureImportRunStatus(database.db, {
            expectedApplyAttemptId: applyAttempt.attemptId,
            expectedApplyLeaseOwner: applyAttempt.leaseOwner,
            plan: { ...applyingResult.value.plan, applyAttempt },
            runId: importRunId,
            status: structureImportRunStatuses.applying,
        });
        return renewalResult.isOk();
    };
    const heartbeatResult = await runWithDashboardStructureApplyHeartbeat({
        operation: () =>
            applyReadyActions(
                botToken,
                context.guild.id,
                importRunResult.value.actions,
                readRequestedGuildId(importRunResult.value.plan),
                readApplySourceTargetMap(importRunResult.value.plan),
                readImportMode(importRunResult.value.plan),
                () => renewApplyLease(new Date())
            ),
        renew: async (now) => {
            if (!(await renewApplyLease(now))) throw new Error('structure-apply-heartbeat-failed');
        },
    });
    const applyResult = heartbeatResult.value;
    const finalStatus =
        applyResult.actions.every((result) => result.status === structureImportActionStatuses.applied) &&
        applyResult.roleOrderStatus !== 'failed'
            ? structureImportRunStatuses.applied
            : structureImportRunStatuses.failed;
    applyAttempt = completeDashboardStructureApplyAttempt(applyAttempt, {
        now: new Date(),
        outcome: finalStatus === structureImportRunStatuses.applied ? 'succeeded' : 'failed',
        ...(applyResult.roleOrderStatus ? { roleOrderStatus: applyResult.roleOrderStatus } : {}),
        ...(applyResult.roleOrderErrorType ? { roleOrderErrorType: applyResult.roleOrderErrorType } : {}),
        ...(restorePointResult ? { restorePointBackupId: restorePointResult.id } : {}),
    });
    const finalRunResult = await updateStructureImportRunStatus(database.db, {
        expectedApplyAttemptId: applyAttempt.attemptId,
        expectedApplyLeaseOwner: applyAttempt.leaseOwner,
        runId: importRunId,
        status: finalStatus,
        plan: {
            ...applyingResult.value.plan,
            applyAttempt,
            applySummary: {
                applied: applyResult.actions.filter((result) => result.status === structureImportActionStatuses.applied)
                    .length,
                failed: applyResult.actions.filter((result) => result.status === structureImportActionStatuses.failed)
                    .length,
                sourceTargetMap: applyResult.idMap,
                ...(applyResult.roleOrderStatus ? { roleOrderStatus: applyResult.roleOrderStatus } : {}),
                ...(applyResult.roleOrderErrorType ? { roleOrderErrorType: applyResult.roleOrderErrorType } : {}),
                ...(restorePointResult ? { restorePointBackupId: restorePointResult.id } : {}),
                ...(heartbeatResult.heartbeatFailed ? { heartbeatFailed: true } : {}),
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

async function applyReadyActions(
    botToken: string,
    guildId: string,
    actions: StructureImportActionRecord[],
    sourceGuildId: string | undefined,
    initialIdMap: Record<string, string>,
    importMode: 'merge' | 'replace',
    beforeMutation: () => Promise<boolean>
) {
    const database = await getWebDb();
    const results: Array<{ actionId: string; status: string }> = [];
    const roleOrderAction = actions.find((action) => action.targetType === 'role-order');
    const executableActions = actions.filter((action) => action.targetType !== 'role-order');
    const orderedActions = orderDashboardStructureImportActions(executableActions, importMode);
    const sourceTargetMap = {
        ...initialIdMap,
        ...readMatchedRoleSourceTargetMap(actions),
    };
    const persistedRoleOrder = readPersistedRoleOrder(actions);
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
                changes: readStructureActionChanges(details),
                after: details.after,
            };
        }),
        beforeMutation,
        ...(sourceGuildId ? { sourceGuildId } : {}),
        ...(Object.keys(sourceTargetMap).length > 0 ? { idMap: sourceTargetMap } : {}),
        ...(persistedRoleOrder ? { roleOrder: persistedRoleOrder } : {}),
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

    for (const action of executableActions) {
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

    if (roleOrderAction) {
        const roleOrderStatus =
            applyResult.value.roleOrder?.status === 'applied'
                ? structureImportActionStatuses.applied
                : structureImportActionStatuses.failed;
        const roleOrderDetails = {
            ...toJsonRecord(roleOrderAction.details),
            appliedAt: new Date().toISOString(),
            ...(applyResult.value.roleOrder?.errorType
                ? { errorType: applyResult.value.roleOrder.errorType }
                : roleOrderStatus === structureImportActionStatuses.failed
                  ? { errorType: 'role-order-skipped' }
                  : {}),
        };
        const roleOrderStatusResult = await updateStructureImportActionStatus(database.db, {
            actionId: roleOrderAction.id,
            details: roleOrderDetails,
            status: roleOrderStatus,
        });
        results.push({
            actionId: roleOrderAction.id,
            status: roleOrderStatusResult.isOk() ? roleOrderStatus : structureImportActionStatuses.failed,
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
