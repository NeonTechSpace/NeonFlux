import { v, type GenericId } from 'convex/values';

import { mutation, type MutationCtx } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { structureExecutionLiveAreas } from '../core/dashboard_live_model.js';
import { recordStructureAuditInMutation } from './structure.js';
import { structureImportTerminalNotification } from './structure_import_terminal.js';
import {
    buildBackupSortCursor,
    buildStructureBackupDocument,
    classifyStructureImportExecutionReclaim,
    resolveExpiredStructureImportControl,
} from './structure_model.js';

const terminalStatuses = [
    'succeeded',
    'partially_applied',
    'failed_before_mutation',
    'needs_reconciliation',
    'outcome_unknown',
    'cancelled',
] as const;

export const claimNextStructureImportExecution = mutation({
    args: { leaseExpiresAt: v.string(), leaseId: v.string(), leaseOwner: v.string(), now: v.string() },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const queued = await ctx.db
            .query('structureImportExecutions')
            .withIndex('by_status_retry', (q) => q.eq('status', 'queued'))
            .first();
        const waiting = queued
            ? null
            : await ctx.db
                  .query('structureImportExecutions')
                  .withIndex('by_status_retry', (q) => q.eq('status', 'waiting_rate_limit').lte('retryAt', args.now))
                  .first();
        let execution = queued ?? waiting;
        if (!execution) {
            for (const status of ['running', 'pause_requested', 'verifying'] as const) {
                const candidates = await ctx.db
                    .query('structureImportExecutions')
                    .withIndex('by_status_retry', (q) => q.eq('status', status))
                    .collect();
                for (const candidate of candidates) {
                    if (
                        candidate.status === 'pause_requested' &&
                        candidate.leaseExpiresAt &&
                        candidate.leaseExpiresAt <= args.now
                    ) {
                        const cancelled =
                            resolveExpiredStructureImportControl(candidate.controlRequest) === 'cancelled';
                        const controlPatch = cancelled
                            ? {
                                  completedAt: args.now,
                                  controlRequest: undefined,
                                  leaseExpiresAt: undefined,
                                  leaseId: undefined,
                                  leaseOwner: undefined,
                                  phase: 'complete' as const,
                                  status: 'cancelled' as const,
                                  updatedAt: args.now,
                              }
                            : {
                                  controlRequest: undefined,
                                  leaseExpiresAt: undefined,
                                  leaseId: undefined,
                                  leaseOwner: undefined,
                                  phase: 'paused' as const,
                                  status: 'paused' as const,
                                  updatedAt: args.now,
                              };
                        await ctx.db.patch('structureImportExecutions', candidate._id, controlPatch);
                        await markDashboardLiveAreasChangedInMutation(ctx, {
                            areas: structureExecutionLiveAreas,
                            guildId: candidate.guildId,
                            now: args.now,
                        });
                        await recordStructureAuditInMutation(
                            ctx,
                            candidate.guildId,
                            {
                                action: cancelled
                                    ? 'structure.import_execution_cancelled'
                                    : 'structure.import_execution_paused',
                            },
                            args.now,
                            String(candidate._id)
                        );
                        continue;
                    }
                    const startedAttempt = await ctx.db
                        .query('structureImportActionAttempts')
                        .withIndex('by_execution_state', (q) =>
                            q.eq('executionId', candidate._id).eq('state', 'started')
                        )
                        .first();
                    const reclaim = classifyStructureImportExecutionReclaim({
                        hasStartedAttempt: Boolean(startedAttempt),
                        ...(candidate.leaseExpiresAt ? { leaseExpiresAt: candidate.leaseExpiresAt } : {}),
                        now: args.now,
                    });
                    if (reclaim === 'active') continue;
                    if (reclaim === 'outcome_unknown') {
                        await ctx.db.patch('structureImportExecutions', candidate._id, {
                            completedAt: args.now,
                            errorType: 'expired-lease-with-started-attempt',
                            leaseExpiresAt: undefined,
                            leaseId: undefined,
                            leaseOwner: undefined,
                            phase: 'complete',
                            status: 'outcome_unknown',
                            updatedAt: args.now,
                        });
                        await markDashboardLiveAreasChangedInMutation(ctx, {
                            areas: structureExecutionLiveAreas,
                            guildId: candidate.guildId,
                            now: args.now,
                        });
                        await recordStructureAuditInMutation(
                            ctx,
                            candidate.guildId,
                            { action: 'structure.import_execution_outcome_unknown' },
                            args.now,
                            String(candidate._id)
                        );
                        continue;
                    }
                    execution = candidate;
                    break;
                }
                if (execution) break;
            }
        }
        if (!execution) return null;
        const patch = {
            heartbeatAt: args.now,
            leaseExpiresAt: args.leaseExpiresAt,
            leaseId: args.leaseId,
            leaseOwner: args.leaseOwner,
            controlRequest: undefined,
            phase: 'preparing' as const,
            startedAt: execution.startedAt ?? args.now,
            status: 'running' as const,
            updatedAt: args.now,
        };
        await ctx.db.patch('structureImportExecutions', execution._id, patch);
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: structureExecutionLiveAreas,
            guildId: execution.guildId,
            now: args.now,
        });
        const run = await ctx.db.get('structureImportRuns', execution.runId);
        const actions = await ctx.db
            .query('structureImportActions')
            .withIndex('by_run_sequence', (q) => q.eq('runId', execution.runId))
            .order('asc')
            .collect();
        const attempts = await ctx.db
            .query('structureImportActionAttempts')
            .withIndex('by_execution_state', (q) => q.eq('executionId', execution._id))
            .collect();
        return { execution: { ...execution, ...patch, id: execution._id }, run, actions, attempts };
    },
});

export const renewStructureImportExecutionLease = mutation({
    args: {
        executionId: v.id('structureImportExecutions'),
        leaseExpiresAt: v.string(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const execution = await ctx.db.get('structureImportExecutions', args.executionId);
        if (
            execution?.leaseId !== args.leaseId ||
            execution.leaseOwner !== args.leaseOwner ||
            !execution.leaseExpiresAt ||
            execution.leaseExpiresAt < args.now
        ) {
            return null;
        }
        if (!['running', 'pause_requested', 'verifying'].includes(execution.status)) return null;
        await ctx.db.patch('structureImportExecutions', execution._id, {
            heartbeatAt: args.now,
            leaseExpiresAt: args.leaseExpiresAt,
            updatedAt: args.now,
        });
        return { ...execution, heartbeatAt: args.now, leaseExpiresAt: args.leaseExpiresAt, updatedAt: args.now };
    },
});

export const ensureStructureImportRestorePoint = mutation({
    args: {
        executionId: v.id('structureImportExecutions'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        structureJson: v.string(),
    },
    returns: v.object({ backupId: v.string() }),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const execution = await requireExecutionLease(ctx, args.executionId, args.leaseId, args.leaseOwner, args.now, [
            'running',
        ]);
        if (execution.restorePointBackupId) return { backupId: execution.restorePointBackupId };
        const built = buildStructureBackupDocument(
            {
                createdAt: args.now,
                guildId: execution.guildId,
                sortKey: buildBackupSortCursor({ createdAt: args.now, id: crypto.randomUUID() }),
                source: 'restore_point',
                status: 'succeeded',
                structure: parseJsonRecord(args.structureJson, 'structure-restore-point-json-invalid'),
            },
            args.now
        );
        if (!built.ok) throw new Error('structure-restore-point-invalid');
        const backupId = await ctx.db.insert('structureBackups', built.value);
        await ctx.db.patch('structureImportExecutions', execution._id, {
            restorePointBackupId: String(backupId),
            updatedAt: args.now,
        });
        return { backupId: String(backupId) };
    },
});

export const requestStructureImportExecutionControl = mutation({
    args: {
        executionId: v.id('structureImportExecutions'),
        now: v.string(),
        request: v.union(v.literal('pause'), v.literal('resume'), v.literal('cancel')),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const execution = await ctx.db.get('structureImportExecutions', args.executionId);
        if (!execution) return null;
        if (terminalStatuses.includes(execution.status as never)) return { ...execution, id: execution._id };
        let status: 'queued' | 'pause_requested' | 'paused' | 'cancelled';
        let controlRequest: 'pause' | 'cancel' | undefined;
        if (args.request === 'resume') {
            if (execution.status !== 'paused') throw new Error('structure-execution-control-invalid');
            status = 'queued';
        } else if (['running', 'verifying', 'pause_requested'].includes(execution.status)) {
            status = 'pause_requested';
            controlRequest = args.request;
        } else if (args.request === 'cancel' && ['queued', 'waiting_rate_limit', 'paused'].includes(execution.status)) {
            status = 'cancelled';
        } else if (args.request === 'pause' && ['queued', 'waiting_rate_limit'].includes(execution.status)) {
            status = 'paused';
        } else {
            throw new Error('structure-execution-control-invalid');
        }
        const patch = {
            ...(controlRequest ? { controlRequest } : { controlRequest: undefined }),
            ...(status === 'cancelled'
                ? {
                      completedAt: args.now,
                      leaseExpiresAt: undefined,
                      leaseId: undefined,
                      leaseOwner: undefined,
                      phase: 'complete' as const,
                  }
                : {}),
            status,
            updatedAt: args.now,
        };
        await ctx.db.patch('structureImportExecutions', execution._id, patch);
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: structureExecutionLiveAreas,
            guildId: execution.guildId,
            now: args.now,
        });
        if (status === 'paused')
            await recordStructureAuditInMutation(
                ctx,
                execution.guildId,
                { action: 'structure.import_execution_paused' },
                args.now,
                String(execution._id)
            );
        if (args.request === 'resume')
            await recordStructureAuditInMutation(
                ctx,
                execution.guildId,
                { action: 'structure.import_execution_resumed' },
                args.now,
                String(execution._id)
            );
        if (status === 'cancelled')
            await recordStructureAuditInMutation(
                ctx,
                execution.guildId,
                { action: 'structure.import_execution_cancelled' },
                args.now,
                String(execution._id)
            );
        return { ...execution, ...patch, id: execution._id };
    },
});

export const checkpointStructureImportExecution = mutation({
    args: {
        appliedActions: v.number(),
        completedMutationSteps: v.number(),
        currentActionDomain: v.optional(v.string()),
        currentActionId: v.optional(v.string()),
        currentActionLabel: v.optional(v.string()),
        errorType: v.optional(v.string()),
        executionId: v.id('structureImportExecutions'),
        failedActions: v.number(),
        idMapJson: v.string(),
        leaseId: v.string(),
        leaseOwner: v.string(),
        nextActionSequence: v.number(),
        notStartedActions: v.number(),
        now: v.string(),
        phase: v.union(
            v.literal('queued'),
            v.literal('preparing'),
            v.literal('create'),
            v.literal('update'),
            v.literal('delete'),
            v.literal('channel_order'),
            v.literal('role_order'),
            v.literal('waiting_rate_limit'),
            v.literal('paused'),
            v.literal('verifying'),
            v.literal('complete')
        ),
        retryAt: v.optional(v.string()),
        restorePointBackupId: v.optional(v.string()),
        status: v.union(
            v.literal('running'),
            v.literal('waiting_rate_limit'),
            v.literal('pause_requested'),
            v.literal('paused'),
            v.literal('verifying')
        ),
        skippedActions: v.number(),
        totalMutationSteps: v.number(),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const execution = await requireExecutionLease(ctx, args.executionId, args.leaseId, args.leaseOwner, args.now, [
            'running',
            'pause_requested',
            'verifying',
        ]);
        if (
            args.nextActionSequence < execution.nextActionSequence ||
            args.nextActionSequence > execution.totalActions
        ) {
            throw new Error('structure-execution-cursor-invalid');
        }
        if (
            [args.appliedActions, args.failedActions, args.skippedActions, args.completedMutationSteps].some(
                (value) => !Number.isInteger(value) || value < 0
            )
        ) {
            throw new Error('structure-execution-progress-invalid');
        }
        if (
            args.completedMutationSteps > args.totalMutationSteps ||
            args.totalMutationSteps !== execution.totalMutationSteps
        ) {
            throw new Error('structure-execution-mutation-progress-invalid');
        }
        if (
            execution.restorePointBackupId &&
            args.restorePointBackupId &&
            execution.restorePointBackupId !== args.restorePointBackupId
        ) {
            throw new Error('structure-execution-restore-point-conflict');
        }
        if (execution.status === 'pause_requested' && args.status !== 'pause_requested' && args.status !== 'paused') {
            throw new Error('structure-execution-pause-fence');
        }
        if (execution.status === 'verifying' && args.status !== 'verifying')
            throw new Error('structure-execution-verification-fence');
        const patch = {
            appliedActions: args.appliedActions,
            completedMutationSteps: args.completedMutationSteps,
            ...(args.currentActionDomain ? { currentActionDomain: args.currentActionDomain } : {}),
            ...(args.currentActionId ? { currentActionId: args.currentActionId } : {}),
            ...(args.currentActionLabel ? { currentActionLabel: args.currentActionLabel } : {}),
            ...(args.errorType ? { errorType: args.errorType } : {}),
            failedActions: args.failedActions,
            idMap: parseJsonRecord(args.idMapJson, 'structure-execution-id-map-invalid'),
            nextActionSequence: args.nextActionSequence,
            notStartedActions: args.notStartedActions,
            phase: args.phase,
            ...(args.retryAt ? { retryAt: args.retryAt } : {}),
            ...(args.restorePointBackupId ? { restorePointBackupId: args.restorePointBackupId } : {}),
            skippedActions: args.skippedActions,
            status: args.status,
            totalMutationSteps: args.totalMutationSteps,
        };
        await ctx.db.patch('structureImportExecutions', execution._id, { ...patch, updatedAt: args.now });
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: structureExecutionLiveAreas,
            guildId: execution.guildId,
            now: args.now,
        });
        if (args.status === 'paused')
            await recordStructureAuditInMutation(
                ctx,
                execution.guildId,
                { action: 'structure.import_execution_paused' },
                args.now,
                String(execution._id)
            );
        return { ...execution, ...patch, updatedAt: args.now };
    },
});

export const finalizeStructureImportExecution = mutation({
    args: {
        errorType: v.optional(v.string()),
        executionId: v.id('structureImportExecutions'),
        leaseId: v.string(),
        leaseOwner: v.string(),
        now: v.string(),
        restorePointBackupId: v.optional(v.string()),
        status: v.union(
            v.literal('succeeded'),
            v.literal('partially_applied'),
            v.literal('failed_before_mutation'),
            v.literal('needs_reconciliation'),
            v.literal('outcome_unknown'),
            v.literal('cancelled')
        ),
        verificationResultJson: v.optional(v.string()),
        verificationStatus: v.optional(v.union(v.literal('matched'), v.literal('mismatch'), v.literal('read_failed'))),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['bot']);
        const execution = await requireExecutionLease(ctx, args.executionId, args.leaseId, args.leaseOwner, args.now, [
            'running',
            'pause_requested',
            'verifying',
        ]);
        const patch = {
            completedAt: args.now,
            ...(args.errorType ? { errorType: args.errorType } : {}),
            ...(args.restorePointBackupId ? { restorePointBackupId: args.restorePointBackupId } : {}),
            status: args.status,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            phase: 'complete' as const,
            updatedAt: args.now,
            ...(args.verificationResultJson
                ? {
                      verificationResult: parseJsonRecord(
                          args.verificationResultJson,
                          'structure-execution-verification-invalid'
                      ),
                  }
                : {}),
            ...(args.verificationStatus ? { verificationStatus: args.verificationStatus } : {}),
        };
        await ctx.db.patch('structureImportExecutions', execution._id, patch);
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: structureExecutionLiveAreas,
            guildId: execution.guildId,
            now: args.now,
        });
        const notification = structureImportTerminalNotification(args.status);
        if (notification.canonicalDestination === 'structure') {
            await markDashboardLiveAreasChangedInMutation(ctx, {
                areas: ['structure'],
                guildId: execution.guildId,
                now: args.now,
            });
        } else {
            await recordStructureAuditInMutation(
                ctx,
                execution.guildId,
                { action: notification.auditAction },
                args.now,
                String(execution._id)
            );
        }
        return { ...execution, ...patch, id: execution._id };
    },
});

export async function requireExecutionLease(
    ctx: MutationCtx,
    executionId: GenericId<'structureImportExecutions'>,
    leaseId: string,
    leaseOwner: string,
    now: string,
    allowedStatuses: readonly string[]
) {
    const execution = await ctx.db.get('structureImportExecutions', executionId);
    if (
        execution?.leaseId !== leaseId ||
        execution.leaseOwner !== leaseOwner ||
        !execution.leaseExpiresAt ||
        execution.leaseExpiresAt < now ||
        !allowedStatuses.includes(execution.status)
    )
        throw new Error('structure-execution-lease-lost');
    return execution;
}

function parseJsonRecord(value: string, errorType: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // The stable domain error below is the only parse detail callers need.
    }
    throw new Error(errorType);
}
