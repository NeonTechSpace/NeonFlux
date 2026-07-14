import '@tanstack/react-start/server-only';

import {
    approveBlueprintPlan,
    enqueueBlueprintRun,
    findLatestBlueprintRunForPlan,
    findBlueprintPlanWithStepsByGuildId,
    blueprintAuditActions,
    BLUEPRINT_RUN_PROTOCOL_VERSION,
    blueprintPlanStatuses,
    requestBlueprintRunControl,
} from '@neonflux/db';

import { getWebDb } from './db.server.js';
import { createBlueprintAuditInput, loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import type { DashboardBlueprintErrorResult } from './dashboard-blueprint-model.js';
import { getDashboardBlueprintDeleteApprovalText } from './dashboard-blueprint-contracts.js';

export type DashboardBlueprintApplyInput = {
    guildId: string;
    planId: string;
    planDigest: string;
    preflightDigest: string;
    destructiveConfirmationText?: string;
};

export type DashboardBlueprintApplyResult =
    | {
          type: 'queued';
          run: {
              id: string;
              status: string;
              totalSteps: number;
              createdAt: string;
          };
      }
    | { type: 'invalid-input'; message: string }
    | { type: 'plan-digest-mismatch' }
    | { type: 'review-stale' }
    | { type: 'run-active' }
    | { type: 'nothing-to-apply' }
    | { type: 'destructive-confirmation-mismatch'; expectedText: string }
    | { type: 'not-applicable'; status: string }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintRunControlInput = {
    guildId: string;
    planId: string;
    runId: string;
    request: 'pause' | 'resume' | 'cancel';
};

export type DashboardBlueprintRunControlResult =
    | { type: 'run-updated'; runId: string; status: string; updatedAt: string }
    | {
          type: 'run-protocol-incompatible';
          runProtocolVersion: number;
          requiredProtocolVersion: number;
      }
    | { type: 'invalid-input'; message: string }
    | { type: 'not-controllable'; status: string }
    | DashboardBlueprintErrorResult;

export async function applyDashboardBlueprintPlan(
    request: Request,
    input: DashboardBlueprintApplyInput
): Promise<DashboardBlueprintApplyResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;

    const planId = input.planId.trim();
    if (!planId) return { type: 'invalid-input', message: 'Choose an approved Blueprint plan to queue.' };

    const database = await getWebDb();
    const planResult = await findBlueprintPlanWithStepsByGuildId(database.db, {
        guildId: context.guild.id,
        planId: planId,
    });
    if (planResult.isErr()) return mapRepositoryError(planResult.error);
    if (planResult.value.status !== blueprintPlanStatuses.approved) {
        return { type: 'not-applicable', status: planResult.value.status };
    }
    if (planResult.value.steps.length === 0) return { type: 'nothing-to-apply' };
    if (!input.planDigest || input.planDigest !== planResult.value.planDigest) {
        return { type: 'plan-digest-mismatch' };
    }
    if (!input.preflightDigest) {
        return { type: 'invalid-input', message: 'Run and review a current safety check before queueing.' };
    }

    const deleteStepCount = planResult.value.deleteStepCount;
    if (deleteStepCount > 0) {
        if (!planResult.value.deleteSetDigest) {
            return { type: 'invalid-input', message: 'The persisted delete set is incomplete. Create a new plan.' };
        }
        const expectedText = getDashboardBlueprintDeleteApprovalText(
            planId,
            deleteStepCount,
            planResult.value.deleteSetDigest
        );
        if (input.destructiveConfirmationText?.trim() !== expectedText) {
            return { type: 'destructive-confirmation-mismatch', expectedText };
        }
        const approvedAt = new Date();
        const approvalResult = await approveBlueprintPlan(database.db, {
            planId: planId,
            planDigest: planResult.value.planDigest,
            approvedByUserId: context.actor.actorUserId,
            approvedAt,
            deleteSetDigest: planResult.value.deleteSetDigest,
            destructiveStepCount: deleteStepCount,
            destructiveApprovedAt: approvedAt,
            destructivePreflightDigest: input.preflightDigest,
            audit: createBlueprintAuditInput(context, blueprintAuditActions.planApproved, planId, {
                approvalType: 'destructive',
                deleteStepCount,
                deleteSetDigest: planResult.value.deleteSetDigest,
                planDigest: planResult.value.planDigest,
                preflightDigest: input.preflightDigest,
            }),
        });
        if (approvalResult.isErr()) return mapRepositoryError(approvalResult.error);
    }

    const runResult = await enqueueBlueprintRun(database.db, {
        planId: planId,
        now: new Date(),
        preflightDigest: input.preflightDigest,
        audit: createBlueprintAuditInput(context, blueprintAuditActions.runQueued, planId, {
            stepCount: planResult.value.steps.length,
            deleteStepCount,
            planDigest: planResult.value.planDigest,
            preflightDigest: input.preflightDigest,
        }),
    });
    if (runResult.isErr()) return mapEnqueueRepositoryError(runResult.error);

    return {
        type: 'queued',
        run: {
            id: runResult.value.id,
            status: runResult.value.status,
            totalSteps: runResult.value.totalSteps,
            createdAt: runResult.value.createdAt.toISOString(),
        },
    };
}

export async function controlDashboardBlueprintRun(
    request: Request,
    input: DashboardBlueprintRunControlInput
): Promise<DashboardBlueprintRunControlResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    if (!input.planId || !input.runId) return { type: 'invalid-input', message: 'Choose a Blueprint run.' };

    const database = await getWebDb();
    const latest = await findLatestBlueprintRunForPlan(database.db, {
        guildId: context.guild.id,
        planId: input.planId,
    });
    if (latest.isErr()) return mapRepositoryError(latest.error);
    if (!latest.value || latest.value.id !== input.runId) return { type: 'not-found' };
    if (latest.value.protocolVersion !== BLUEPRINT_RUN_PROTOCOL_VERSION) {
        return {
            type: 'run-protocol-incompatible',
            runProtocolVersion: latest.value.protocolVersion,
            requiredProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        };
    }

    const allowed =
        (input.request === 'pause' && ['running', 'waiting_rate_limit'].includes(latest.value.status)) ||
        (input.request === 'resume' && latest.value.status === 'paused') ||
        (input.request === 'cancel' && ['queued', 'paused'].includes(latest.value.status));
    if (!allowed) return { type: 'not-controllable', status: latest.value.status };

    const result = await requestBlueprintRunControl(database.db, {
        audit: createBlueprintAuditInput(
            context,
            input.request === 'pause'
                ? blueprintAuditActions.runPauseRequested
                : input.request === 'cancel'
                  ? blueprintAuditActions.runCancelRequested
                  : blueprintAuditActions.runResumed,
            input.runId,
            { request: input.request, planId: input.planId }
        ),
        runId: input.runId,
        request: input.request,
        now: new Date(),
    });
    if (result.isErr()) return mapRepositoryError(result.error);
    return {
        type: 'run-updated',
        runId: result.value.id,
        status: result.value.status,
        updatedAt: result.value.updatedAt.toISOString(),
    };
}

function mapRepositoryError(error: { type: string }): DashboardBlueprintErrorResult {
    return error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
}

function mapEnqueueRepositoryError(error: { type: string }): DashboardBlueprintApplyResult {
    if (error.type === 'blueprint-run-review-stale') return { type: 'review-stale' };
    if (error.type === 'blueprint-guild-run-active') return { type: 'run-active' };
    if (error.type === 'blueprint-run-empty') return { type: 'nothing-to-apply' };
    return mapRepositoryError(error);
}
