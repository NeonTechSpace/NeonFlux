import '@tanstack/react-start/server-only';

import {
    approveBlueprintPlan,
    enqueueBlueprintRun,
    getBlueprintPlanMetadata,
    listLatestBlueprintRunSummaries,
    blueprintAuditActions,
    BLUEPRINT_RUN_PROTOCOL_VERSION,
    blueprintPlanStatuses,
    requestBlueprintRunControl,
} from '@neonflux/db';

import { getWebDb } from './db.server.js';
import { createBlueprintAuditInput, loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import type { DashboardBlueprintErrorResult } from './dashboard-blueprint-model.js';

export type DashboardBlueprintApplyInput = {
    guildId: string;
    planId: string;
    planDigest: string;
    preflightDigest: string;
    confirmation?: {
        understandsDeletion?: true;
        understandsRestorePointRequirement?: true;
        targetGuildName?: string;
    };
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
    | { type: 'destructive-confirmation-mismatch'; message: string }
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
    const planResult = await getBlueprintPlanMetadata(database.db, {
        guildId: context.guild.id,
        planId: planId,
    });
    if (planResult.isErr()) return mapRepositoryError(planResult.error);
    if (planResult.value.status !== blueprintPlanStatuses.approved) {
        return { type: 'not-applicable', status: planResult.value.status };
    }
    if (planResult.value.stepCount === 0) return { type: 'nothing-to-apply' };
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
        const confirmation = input.confirmation;
        if (planResult.value.policy === 'merge') {
            return { type: 'invalid-input', message: 'Merge plans cannot contain destructive steps.' };
        }
        if (confirmation?.understandsDeletion !== true) {
            return {
                type: 'destructive-confirmation-mismatch',
                message: `Acknowledge that ${String(deleteStepCount)} existing objects will be removed.`,
            };
        }
        if (planResult.value.policy === 'rebuild') {
            if (confirmation.understandsRestorePointRequirement !== true) {
                return {
                    type: 'destructive-confirmation-mismatch',
                    message: 'Acknowledge that NeonFlux must create a restore point before mutation.',
                };
            }
            if (
                normalizeConfirmationName(confirmation.targetGuildName) !==
                normalizeConfirmationName(context.guild.name)
            ) {
                return {
                    type: 'destructive-confirmation-mismatch',
                    message: `Type “${context.guild.name}” exactly to confirm this rebuild.`,
                };
            }
        }
    }

    const approvedAt = new Date();
    const approvalResult = await approveBlueprintPlan(database.db, {
        planId: planId,
        planDigest: planResult.value.planDigest,
        approvedByUserId: context.actor.actorUserId,
        approvedAt,
        deleteSetDigest: deleteStepCount > 0 ? (planResult.value.deleteSetDigest ?? null) : null,
        destructiveStepCount: deleteStepCount > 0 ? deleteStepCount : null,
        destructiveApprovedAt: deleteStepCount > 0 ? approvedAt : null,
        destructivePreflightDigest: input.preflightDigest,
        confirmationMethod: planResult.value.policy === 'rebuild' ? 'target_name' : 'acknowledgement',
        audit: createBlueprintAuditInput(context, blueprintAuditActions.planApproved, planId, {
            approvalType: deleteStepCount > 0 ? 'destructive-deploy' : 'deploy',
            deleteStepCount,
            ...(planResult.value.deleteSetDigest ? { deleteSetDigest: planResult.value.deleteSetDigest } : {}),
            planDigest: planResult.value.planDigest,
            preflightDigest: input.preflightDigest,
        }),
    });
    if (approvalResult.isErr()) return mapRepositoryError(approvalResult.error);

    const runResult = await enqueueBlueprintRun(database.db, {
        planId: planId,
        now: new Date(),
        preflightDigest: input.preflightDigest,
        audit: createBlueprintAuditInput(context, blueprintAuditActions.runQueued, planId, {
            stepCount: planResult.value.stepCount,
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

function normalizeConfirmationName(value: string | undefined): string {
    return value?.normalize('NFC').trim() ?? '';
}

export async function controlDashboardBlueprintRun(
    request: Request,
    input: DashboardBlueprintRunControlInput
): Promise<DashboardBlueprintRunControlResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    if (!input.planId || !input.runId) return { type: 'invalid-input', message: 'Choose a Blueprint run.' };

    const database = await getWebDb();
    const latestRuns = await listLatestBlueprintRunSummaries(database.db, {
        guildId: context.guild.id,
        planIds: [input.planId],
    });
    if (latestRuns.isErr()) return mapRepositoryError(latestRuns.error);
    const latest = latestRuns.value[input.planId];
    if (!latest || latest.id !== input.runId) return { type: 'not-found' };
    if (latest.protocolVersion !== BLUEPRINT_RUN_PROTOCOL_VERSION) {
        return {
            type: 'run-protocol-incompatible',
            runProtocolVersion: latest.protocolVersion,
            requiredProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        };
    }

    const allowed =
        (input.request === 'pause' && ['running', 'waiting_rate_limit'].includes(latest.status)) ||
        (input.request === 'resume' && latest.status === 'paused') ||
        (input.request === 'cancel' && ['queued', 'paused'].includes(latest.status));
    if (!allowed) return { type: 'not-controllable', status: latest.status };

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
