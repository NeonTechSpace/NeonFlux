import type { GenericId } from 'convex/values';

import type { MutationCtx } from '../_generated/server.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { blueprintRunLiveAreas } from '../core/dashboard_live_model.js';
import { recordBlueprintAuditInMutation } from './blueprint.js';
import { blueprintRunTerminalNotification, type BlueprintRunTerminalStatus } from './blueprint_run_terminal.js';
import { assertCurrentBlueprintRunProtocol } from './blueprint_run_protocol.js';

export async function finalizeBlueprintRunInMutation(
    ctx: MutationCtx,
    input: {
        errorType?: string;
        run: {
            _id: GenericId<'blueprintRuns'>;
            appliedSteps?: number;
            completedMutationSteps?: number;
            guildId: string;
            notStartedSteps?: number;
            protocolVersion: number;
            totalSteps?: number;
        };
        now: string;
        restorePointBackupId?: string;
        status: BlueprintRunTerminalStatus;
        verificationResult?: Record<string, unknown>;
        verificationStatus?: 'matched' | 'mismatch' | 'read_failed';
    }
) {
    assertCurrentBlueprintRunProtocol(input.run);
    const patch = buildBlueprintRunTerminalPatch(input);
    await ctx.db.patch('blueprintRuns', input.run._id, patch);
    await markDashboardLiveAreasChangedInMutation(ctx, {
        areas: blueprintRunLiveAreas,
        guildId: input.run.guildId,
        now: input.now,
    });
    const notification = blueprintRunTerminalNotification(input.status);
    await recordBlueprintAuditInMutation(
        ctx,
        input.run.guildId,
        {
            action: notification.auditAction,
            metadata: {
                ...(input.errorType ? { failureReason: input.errorType } : {}),
                protocolVersion: input.run.protocolVersion,
                appliedSteps: input.run.appliedSteps ?? 0,
                completedMutationSteps: input.run.completedMutationSteps ?? 0,
                notStartedSteps: input.run.notStartedSteps ?? input.run.totalSteps ?? 0,
                totalSteps: input.run.totalSteps ?? 0,
                ...(input.restorePointBackupId ? { restorePointBackupId: input.restorePointBackupId } : {}),
            },
        },
        input.now,
        String(input.run._id)
    );
    return patch;
}

export function resolveBlueprintRunFinalizationStatus(input: {
    controlRequest?: 'pause' | 'cancel';
    runStatus: string;
    requestedStatus: BlueprintRunTerminalStatus;
}): BlueprintRunTerminalStatus | 'paused' {
    if (
        input.runStatus !== 'pause_requested' ||
        (input.requestedStatus !== 'succeeded' && input.requestedStatus !== 'needs_reconciliation')
    ) {
        return input.requestedStatus;
    }

    return input.controlRequest === 'cancel' ? 'cancelled' : 'paused';
}

export function buildBlueprintRunPausedPatch(now: string) {
    return {
        controlRequest: undefined,
        errorType: undefined,
        heartbeatAt: undefined,
        leaseExpiresAt: undefined,
        leaseId: undefined,
        leaseOwner: undefined,
        phase: 'paused' as const,
        retryAt: undefined,
        status: 'paused' as const,
        updatedAt: now,
    };
}

export function buildBlueprintRunTerminalPatch(input: {
    errorType?: string;
    now: string;
    restorePointBackupId?: string;
    status: BlueprintRunTerminalStatus;
    verificationResult?: Record<string, unknown>;
    verificationStatus?: 'matched' | 'mismatch' | 'read_failed';
}) {
    return {
        completedAt: input.now,
        controlRequest: undefined,
        errorType: input.errorType,
        ...(input.restorePointBackupId ? { restorePointBackupId: input.restorePointBackupId } : {}),
        status: input.status,
        leaseExpiresAt: undefined,
        leaseId: undefined,
        leaseOwner: undefined,
        phase: 'complete' as const,
        retryAt: undefined,
        updatedAt: input.now,
        ...(input.verificationResult ? { verificationResult: input.verificationResult } : {}),
        ...(input.verificationStatus ? { verificationStatus: input.verificationStatus } : {}),
    };
}
