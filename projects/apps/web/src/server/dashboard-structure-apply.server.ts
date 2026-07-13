import '@tanstack/react-start/server-only';

import {
    approveStructureImportPlan,
    enqueueStructureImportExecution,
    findLatestStructureImportExecution,
    findStructureImportRunWithActionsByGuildId,
    structureAuditActions,
    STRUCTURE_EXECUTION_PROTOCOL_VERSION,
    structureImportRunStatuses,
    requestStructureImportExecutionControl,
} from '@neonflux/db';

import { getWebDb } from './db.server.js';
import { createStructureAuditInput, loadAuthorizedStructureContext } from './dashboard-structure-context.server.js';
import type { DashboardStructureErrorResult } from './dashboard-structure-context.server.js';
import { getDashboardStructureDeleteApprovalText } from './dashboard-structure-contracts.js';

export type DashboardStructureApplyInput = {
    guildId: string;
    importRunId: string;
    planDigest: string;
    preflightDigest: string;
    destructiveConfirmationText?: string;
};

export type DashboardStructureApplyResult =
    | {
          type: 'queued';
          execution: {
              id: string;
              status: string;
              totalActions: number;
              createdAt: string;
          };
      }
    | { type: 'invalid-input'; message: string }
    | { type: 'plan-digest-mismatch' }
    | { type: 'review-stale' }
    | { type: 'execution-active' }
    | { type: 'nothing-to-apply' }
    | { type: 'destructive-confirmation-mismatch'; expectedText: string }
    | { type: 'not-applicable'; status: string }
    | DashboardStructureErrorResult;

export type DashboardStructureExecutionControlInput = {
    guildId: string;
    runId: string;
    executionId: string;
    request: 'pause' | 'resume' | 'cancel';
};

export type DashboardStructureExecutionControlResult =
    | { type: 'execution-updated'; executionId: string; status: string; updatedAt: string }
    | {
          type: 'execution-protocol-incompatible';
          executionProtocolVersion: number;
          requiredProtocolVersion: number;
      }
    | { type: 'invalid-input'; message: string }
    | { type: 'not-controllable'; status: string }
    | DashboardStructureErrorResult;

export async function applyDashboardStructureImportRun(
    request: Request,
    input: DashboardStructureApplyInput
): Promise<DashboardStructureApplyResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
    if (context.type !== 'authorized') return context;

    const importRunId = input.importRunId.trim();
    if (!importRunId) return { type: 'invalid-input', message: 'Choose an approved import plan to queue.' };

    const database = await getWebDb();
    const runResult = await findStructureImportRunWithActionsByGuildId(database.db, {
        guildId: context.guild.id,
        runId: importRunId,
    });
    if (runResult.isErr()) return mapRepositoryError(runResult.error);
    if (runResult.value.status !== structureImportRunStatuses.approved) {
        return { type: 'not-applicable', status: runResult.value.status };
    }
    if (runResult.value.actions.length === 0) return { type: 'nothing-to-apply' };
    if (!input.planDigest || input.planDigest !== runResult.value.planDigest) {
        return { type: 'plan-digest-mismatch' };
    }
    if (!input.preflightDigest) {
        return { type: 'invalid-input', message: 'Run and review a current safety check before queueing.' };
    }

    const deleteActionCount = runResult.value.deleteActionCount;
    if (deleteActionCount > 0) {
        if (!runResult.value.deleteSetDigest) {
            return { type: 'invalid-input', message: 'The persisted delete set is incomplete. Create a new plan.' };
        }
        const expectedText = getDashboardStructureDeleteApprovalText(
            importRunId,
            deleteActionCount,
            runResult.value.deleteSetDigest
        );
        if (input.destructiveConfirmationText?.trim() !== expectedText) {
            return { type: 'destructive-confirmation-mismatch', expectedText };
        }
        const approvedAt = new Date();
        const approvalResult = await approveStructureImportPlan(database.db, {
            runId: importRunId,
            planDigest: runResult.value.planDigest,
            approvedByUserId: context.actor.actorUserId,
            approvedAt,
            deleteSetDigest: runResult.value.deleteSetDigest,
            destructiveActionCount: deleteActionCount,
            destructiveApprovedAt: approvedAt,
            destructivePreflightDigest: input.preflightDigest,
            audit: createStructureAuditInput(context, structureAuditActions.importPlanApproved, importRunId, {
                approvalType: 'destructive',
                deleteActionCount,
                deleteSetDigest: runResult.value.deleteSetDigest,
                planDigest: runResult.value.planDigest,
                preflightDigest: input.preflightDigest,
            }),
        });
        if (approvalResult.isErr()) return mapRepositoryError(approvalResult.error);
    }

    const executionResult = await enqueueStructureImportExecution(database.db, {
        runId: importRunId,
        now: new Date(),
        preflightDigest: input.preflightDigest,
        audit: createStructureAuditInput(context, structureAuditActions.importExecutionQueued, importRunId, {
            actionCount: runResult.value.actions.length,
            deleteActionCount,
            planDigest: runResult.value.planDigest,
            preflightDigest: input.preflightDigest,
        }),
    });
    if (executionResult.isErr()) return mapEnqueueRepositoryError(executionResult.error);

    return {
        type: 'queued',
        execution: {
            id: executionResult.value.id,
            status: executionResult.value.status,
            totalActions: executionResult.value.totalActions,
            createdAt: executionResult.value.createdAt.toISOString(),
        },
    };
}

export async function controlDashboardStructureImportExecution(
    request: Request,
    input: DashboardStructureExecutionControlInput
): Promise<DashboardStructureExecutionControlResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    if (!input.runId || !input.executionId) return { type: 'invalid-input', message: 'Choose a deployment execution.' };

    const database = await getWebDb();
    const latest = await findLatestStructureImportExecution(database.db, {
        guildId: context.guild.id,
        runId: input.runId,
    });
    if (latest.isErr()) return mapRepositoryError(latest.error);
    if (!latest.value || latest.value.id !== input.executionId) return { type: 'not-found' };
    if (latest.value.protocolVersion !== STRUCTURE_EXECUTION_PROTOCOL_VERSION) {
        return {
            type: 'execution-protocol-incompatible',
            executionProtocolVersion: latest.value.protocolVersion,
            requiredProtocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
        };
    }

    const allowed =
        (input.request === 'pause' && ['running', 'waiting_rate_limit'].includes(latest.value.status)) ||
        (input.request === 'resume' && latest.value.status === 'paused') ||
        (input.request === 'cancel' && ['queued', 'paused'].includes(latest.value.status));
    if (!allowed) return { type: 'not-controllable', status: latest.value.status };

    const result = await requestStructureImportExecutionControl(database.db, {
        audit: createStructureAuditInput(
            context,
            input.request === 'pause'
                ? structureAuditActions.importExecutionPauseRequested
                : input.request === 'cancel'
                  ? structureAuditActions.importExecutionCancelRequested
                  : structureAuditActions.importExecutionResumed,
            input.executionId,
            { request: input.request, runId: input.runId }
        ),
        executionId: input.executionId,
        request: input.request,
        now: new Date(),
    });
    if (result.isErr()) return mapRepositoryError(result.error);
    return {
        type: 'execution-updated',
        executionId: result.value.id,
        status: result.value.status,
        updatedAt: result.value.updatedAt.toISOString(),
    };
}

function mapRepositoryError(error: { type: string }): DashboardStructureErrorResult {
    return error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
}

function mapEnqueueRepositoryError(error: { type: string }): DashboardStructureApplyResult {
    if (error.type === 'structure-execution-review-stale') return { type: 'review-stale' };
    if (error.type === 'structure-guild-execution-active') return { type: 'execution-active' };
    if (error.type === 'structure-execution-empty') return { type: 'nothing-to-apply' };
    return mapRepositoryError(error);
}
