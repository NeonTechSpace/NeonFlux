import { v } from 'convex/values';

import { mutation } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { structureExecutionLiveAreas } from '../core/dashboard_live_model.js';
import { STRUCTURE_EXECUTION_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { recordStructureAuditInMutation } from './structure.js';
import { requireExecutionLease } from './structure_import_execution.js';
import { finalizeStructureImportExecutionInMutation } from './structure_import_execution_terminal_mutation.js';
import {
    resolveStructureAttemptCompletionStatus,
    validateStructureExecutionAttemptIdMapTransition,
    validateStructureExecutionProgressTransition,
} from './structure_model.js';

export const prepareStructureImportActionAttempt = mutation({
    args: {
        actionId: v.id('structureImportActions'),
        attempt: v.number(),
        executionId: v.id('structureImportExecutions'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        protocolVersion: v.literal(STRUCTURE_EXECUTION_PROTOCOL_VERSION),
        requestKey: v.string(),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const execution = await requireExecutionLease(ctx, args.executionId, args.leaseId, args.leaseOwner, args.now, [
            'running',
            'pause_requested',
        ]);
        if (!Number.isInteger(args.attempt) || args.attempt < 1) throw new Error('structure-attempt-number-invalid');
        const action = await ctx.db.get('structureImportActions', args.actionId);
        if (action?.runId !== execution.runId || action.sequence !== execution.nextActionSequence) {
            throw new Error('structure-attempt-action-invalid');
        }
        const existing = await ctx.db
            .query('structureImportActionAttempts')
            .withIndex('by_execution_action_attempt', (q) =>
                q.eq('executionId', args.executionId).eq('actionId', args.actionId).eq('attempt', args.attempt)
            )
            .first();
        if (existing) return { ...existing, id: existing._id };
        const document = {
            actionId: args.actionId,
            attempt: args.attempt,
            createdAt: args.now,
            executionId: args.executionId,
            requestKey: args.requestKey,
            state: 'pending' as const,
            updatedAt: args.now,
        };
        const id = await ctx.db.insert('structureImportActionAttempts', document);
        return { id, ...document };
    },
});

export const startStructureImportActionAttempt = mutation({
    args: {
        attemptId: v.id('structureImportActionAttempts'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        protocolVersion: v.literal(STRUCTURE_EXECUTION_PROTOCOL_VERSION),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const attempt = await ctx.db.get('structureImportActionAttempts', args.attemptId);
        if (!attempt) throw new Error('structure-attempt-not-found');
        const execution = await requireExecutionLease(
            ctx,
            attempt.executionId,
            args.leaseId,
            args.leaseOwner,
            args.now,
            ['running']
        );
        if (attempt.state !== 'pending') throw new Error('structure-attempt-not-pending');
        const action = await ctx.db.get('structureImportActions', attempt.actionId);
        if (action?.runId !== execution.runId || action.sequence !== execution.nextActionSequence) {
            throw new Error('structure-attempt-action-invalid');
        }
        const patch = { startedAt: args.now, state: 'started' as const, updatedAt: args.now };
        await ctx.db.patch('structureImportActionAttempts', attempt._id, patch);
        return { ...attempt, ...patch, id: attempt._id };
    },
});

export const completeAndCheckpointStructureImportActionAttempt = mutation({
    args: {
        appliedActions: v.number(),
        attemptId: v.id('structureImportActionAttempts'),
        completedMutationSteps: v.number(),
        createdId: v.optional(v.string()),
        currentActionDomain: v.optional(v.string()),
        currentActionId: v.optional(v.string()),
        currentActionLabel: v.optional(v.string()),
        errorType: v.optional(v.string()),
        failedActions: v.number(),
        idMapJson: v.string(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        nextActionSequence: v.number(),
        notStartedActions: v.number(),
        now: v.string(),
        phase: v.union(
            v.literal('preparing'),
            v.literal('create'),
            v.literal('update'),
            v.literal('delete'),
            v.literal('channel_order'),
            v.literal('role_order'),
            v.literal('waiting_rate_limit'),
            v.literal('complete')
        ),
        protocolVersion: v.literal(STRUCTURE_EXECUTION_PROTOCOL_VERSION),
        retryAt: v.optional(v.string()),
        skippedActions: v.number(),
        state: v.union(v.literal('applied'), v.literal('failed'), v.literal('unknown')),
        status: v.union(
            v.literal('running'),
            v.literal('pause_requested'),
            v.literal('waiting_rate_limit'),
            v.literal('partially_applied'),
            v.literal('failed_before_mutation'),
            v.literal('outcome_unknown')
        ),
        totalMutationSteps: v.number(),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const attempt = await ctx.db.get('structureImportActionAttempts', args.attemptId);
        if (!attempt) throw new Error('structure-attempt-not-found');
        const execution = await requireExecutionLease(
            ctx,
            attempt.executionId,
            args.leaseId,
            args.leaseOwner,
            args.now,
            ['running', 'pause_requested']
        );
        if (attempt.state !== 'pending' && attempt.state !== 'started') throw new Error('structure-attempt-terminal');
        if (
            attempt.state === 'pending' &&
            (args.state !== 'failed' || args.createdId !== undefined || args.retryAt !== undefined)
        ) {
            throw new Error('structure-attempt-provider-outcome-without-start');
        }
        const action = await ctx.db.get('structureImportActions', attempt.actionId);
        if (
            action?.runId !== execution.runId ||
            action.sequence !== execution.nextActionSequence ||
            args.currentActionId !== String(action._id)
        ) {
            throw new Error('structure-attempt-action-invalid');
        }
        const run = await ctx.db.get('structureImportRuns', execution.runId);
        if (!run) throw new Error('structure-run-not-found');
        const nextIdMap = validateStructureExecutionAttemptIdMapTransition({
            action,
            attemptState: attempt.state,
            ...(args.createdId !== undefined ? { createdId: args.createdId } : {}),
            plan: run.plan,
            previous: execution.idMap,
            next: parseJsonRecord(args.idMapJson),
            resultState: args.state,
        });
        if (args.nextActionSequence !== action.sequence && args.nextActionSequence !== action.sequence + 1) {
            throw new Error('structure-execution-progress-invalid');
        }
        validateStructureExecutionProgressTransition({
            next: args,
            previous: execution,
        });
        const requestedTerminal =
            args.status === 'partially_applied' ||
            args.status === 'failed_before_mutation' ||
            args.status === 'outcome_unknown';
        if (
            (args.status === 'waiting_rate_limit' &&
                (args.state !== 'failed' || !args.retryAt || args.phase !== 'waiting_rate_limit')) ||
            (args.status === 'outcome_unknown' && (args.state !== 'unknown' || args.phase !== 'complete')) ||
            ((args.status === 'partially_applied' || args.status === 'failed_before_mutation') &&
                (args.state !== 'failed' || args.phase !== 'complete' || !args.errorType)) ||
            (args.status === 'failed_before_mutation' &&
                (args.appliedActions !== 0 || args.completedMutationSteps !== 0)) ||
            (args.status === 'partially_applied' && args.appliedActions === 0) ||
            (!requestedTerminal && args.phase === 'complete')
        ) {
            throw new Error('structure-execution-attempt-outcome-invalid');
        }
        const resolvedStatus = resolveStructureAttemptCompletionStatus({
            controlRequest: execution.controlRequest,
            executionStatus: execution.status,
            requestedStatus: args.status,
        });
        const controlStatus =
            resolvedStatus === 'paused' || resolvedStatus === 'cancelled' ? resolvedStatus : undefined;
        const resolvedPhase =
            controlStatus === 'paused' ? ('paused' as const) : controlStatus ? ('complete' as const) : args.phase;
        const terminal =
            resolvedStatus === 'partially_applied' ||
            resolvedStatus === 'failed_before_mutation' ||
            resolvedStatus === 'outcome_unknown' ||
            resolvedStatus === 'cancelled';
        const attemptPatch = {
            completedAt: args.now,
            ...(args.createdId ? { createdId: args.createdId } : {}),
            ...(args.errorType ? { errorType: args.errorType } : {}),
            ...(args.retryAt ? { retryAt: args.retryAt } : {}),
            state: args.state,
            updatedAt: args.now,
        };
        const executionPatch = {
            appliedActions: args.appliedActions,
            completedMutationSteps: args.completedMutationSteps,
            ...(args.currentActionDomain ? { currentActionDomain: args.currentActionDomain } : {}),
            ...(args.currentActionId ? { currentActionId: args.currentActionId } : {}),
            ...(args.currentActionLabel ? { currentActionLabel: args.currentActionLabel } : {}),
            failedActions: args.failedActions,
            errorType: controlStatus ? undefined : args.errorType,
            idMap: nextIdMap,
            nextActionSequence: args.nextActionSequence,
            notStartedActions: args.notStartedActions,
            phase: resolvedPhase,
            retryAt: controlStatus || terminal ? undefined : args.retryAt,
            skippedActions: args.skippedActions,
            status: resolvedStatus,
            updatedAt: args.now,
            ...(resolvedStatus === 'waiting_rate_limit' || resolvedStatus === 'paused'
                ? {
                      controlRequest: undefined,
                      heartbeatAt: undefined,
                      leaseExpiresAt: undefined,
                      leaseId: undefined,
                      leaseOwner: undefined,
                  }
                : {}),
        };
        await ctx.db.patch('structureImportActionAttempts', attempt._id, attemptPatch);
        let persistedExecutionPatch: Record<string, unknown> = executionPatch;
        if (terminal) {
            await ctx.db.patch('structureImportExecutions', execution._id, executionPatch);
            const terminalPatch = await finalizeStructureImportExecutionInMutation(ctx, {
                execution,
                now: args.now,
                status: resolvedStatus,
                ...(args.errorType ? { errorType: args.errorType } : {}),
            });
            persistedExecutionPatch = { ...executionPatch, ...terminalPatch };
        } else {
            await ctx.db.patch('structureImportExecutions', execution._id, executionPatch);
            await markDashboardLiveAreasChangedInMutation(ctx, {
                areas: structureExecutionLiveAreas,
                guildId: execution.guildId,
                now: args.now,
            });
            if (resolvedStatus === 'paused') {
                await recordStructureAuditInMutation(
                    ctx,
                    execution.guildId,
                    { action: 'structure.import_execution_paused' },
                    args.now,
                    String(execution._id)
                );
            }
        }
        return {
            attempt: { ...attempt, ...attemptPatch, id: attempt._id },
            execution: { ...execution, ...persistedExecutionPatch, id: execution._id },
        };
    },
});

function parseJsonRecord(value: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // The stable domain error below is the only parse detail callers need.
    }
    throw new Error('structure-execution-id-map-invalid');
}
