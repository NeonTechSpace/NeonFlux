import type { GenericId } from 'convex/values';

import type { MutationCtx } from '../_generated/server.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { structureExecutionLiveAreas } from '../core/dashboard_live_model.js';
import { recordStructureAuditInMutation } from './structure.js';
import {
    structureImportTerminalNotification,
    type StructureImportTerminalStatus,
} from './structure_import_terminal.js';
import { assertCurrentStructureExecutionProtocol } from './structure_import_execution_protocol.js';

export async function finalizeStructureImportExecutionInMutation(
    ctx: MutationCtx,
    input: {
        errorType?: string;
        execution: {
            _id: GenericId<'structureImportExecutions'>;
            guildId: string;
            protocolVersion: number;
        };
        now: string;
        restorePointBackupId?: string;
        status: StructureImportTerminalStatus;
        verificationResult?: Record<string, unknown>;
        verificationStatus?: 'matched' | 'mismatch' | 'read_failed';
    }
) {
    assertCurrentStructureExecutionProtocol(input.execution);
    const patch = buildStructureImportExecutionTerminalPatch(input);
    await ctx.db.patch('structureImportExecutions', input.execution._id, patch);
    await markDashboardLiveAreasChangedInMutation(ctx, {
        areas: structureExecutionLiveAreas,
        guildId: input.execution.guildId,
        now: input.now,
    });
    const notification = structureImportTerminalNotification(input.status);
    if (notification.canonicalDestination === 'structure') {
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: ['structure'],
            guildId: input.execution.guildId,
            now: input.now,
        });
    } else {
        await recordStructureAuditInMutation(
            ctx,
            input.execution.guildId,
            { action: notification.auditAction },
            input.now,
            String(input.execution._id)
        );
    }
    return patch;
}

export function resolveStructureImportExecutionFinalizationStatus(input: {
    controlRequest?: 'pause' | 'cancel';
    executionStatus: string;
    requestedStatus: StructureImportTerminalStatus;
}): StructureImportTerminalStatus | 'paused' {
    if (
        input.executionStatus !== 'pause_requested' ||
        (input.requestedStatus !== 'succeeded' && input.requestedStatus !== 'needs_reconciliation')
    ) {
        return input.requestedStatus;
    }

    return input.controlRequest === 'cancel' ? 'cancelled' : 'paused';
}

export function buildStructureImportExecutionPausedPatch(now: string) {
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

export function buildStructureImportExecutionTerminalPatch(input: {
    errorType?: string;
    now: string;
    restorePointBackupId?: string;
    status: StructureImportTerminalStatus;
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
