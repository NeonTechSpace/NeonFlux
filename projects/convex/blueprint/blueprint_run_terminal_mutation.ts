import type { Doc } from '../_generated/dataModel.js';
import type { MutationCtx } from '../_generated/server.js';
import {
    createBlueprintRunTerminalDigest,
    createBlueprintRunTerminalRequestDigest,
    createBlueprintRunTerminalSourceDigest,
    validateBlueprintRunVerificationEvidenceIntegrity,
} from '@neonflux/blueprint/integrity';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { blueprintRunLiveAreas } from '../core/dashboard_live_model.js';
import { recordBlueprintAuditInMutation } from './blueprint_audit.js';
import { blueprintRunTerminalNotification, type BlueprintRunTerminalStatus } from './blueprint_run_terminal.js';
import { patchBlueprintRunChecked } from './blueprint_run_persistence.js';
import { assertCurrentBlueprintRunProtocol } from './blueprint_run_protocol.js';

export async function finalizeBlueprintRunInMutation(
    ctx: MutationCtx,
    input: {
        errorType?: string;
        run: Doc<'blueprintRuns'>;
        now: string;
        status: BlueprintRunTerminalStatus;
        terminalRequestDigest?: string;
        terminalRequestSourceDigest?: string;
        verificationEvidenceDigest?: string;
        verificationEvidenceVersion?: 1;
        verificationStatus?: 'matched' | 'mismatch' | 'read_failed';
    }
) {
    assertCurrentBlueprintRunProtocol(input.run);
    if (!input.terminalRequestDigest && !input.terminalRequestSourceDigest) {
        throw new Error('blueprint-run-terminal-request-identity-required');
    }
    const terminalRequestDigest =
        input.terminalRequestDigest ??
        (await createBlueprintRunTerminalRequestDigestForRecord({
            runId: String(input.run._id),
            requestedStatus: input.status,
            ...(input.terminalRequestSourceDigest ? { sourceDigest: input.terminalRequestSourceDigest } : {}),
            ...(input.errorType ? { errorType: input.errorType } : {}),
            ...(input.verificationEvidenceDigest
                ? {
                      verificationEvidenceDigest: input.verificationEvidenceDigest,
                      verificationStatus: input.verificationStatus,
                  }
                : {}),
        }));
    const finalizedInput = { ...input, terminalRequestDigest };
    assertBlueprintRunTerminalInvariant(finalizedInput);
    const terminalDigest = await createBlueprintRunTerminalDigestForRecord(finalizedInput);
    const patch = buildBlueprintRunTerminalPatch({ ...finalizedInput, terminalDigest });
    await patchBlueprintRunChecked(ctx, input.run, patch);
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
                appliedSteps: input.run.appliedSteps,
                completedMutationSteps: input.run.completedMutationSteps,
                notStartedSteps: input.run.notStartedSteps,
                totalSteps: input.run.totalSteps,
                ...(input.run.restorePointBackupId ? { restorePointBackupId: input.run.restorePointBackupId } : {}),
                ...(input.run.restorePointSnapshotDigest
                    ? { restorePointSnapshotDigest: input.run.restorePointSnapshotDigest }
                    : {}),
                terminalRequestDigest,
                terminalDigest,
            },
        },
        input.now,
        String(input.run._id)
    );
    return patch;
}

export function assertBlueprintRunTerminalInvariant(input: {
    errorType?: string;
    run: {
        appliedSteps: number;
        completedMutationSteps: number;
        failedSteps: number;
        nextStepSequence: number;
        notStartedSteps: number;
        skippedSteps: number;
        totalSteps: number;
    };
    status: BlueprintRunTerminalStatus;
    verificationEvidenceDigest?: string;
    verificationEvidenceVersion?: 1;
    verificationStatus?: 'matched' | 'mismatch' | 'read_failed';
}): void {
    const { run, status } = input;
    const preservesVerificationEvidence = status === 'succeeded' || status === 'needs_reconciliation';
    const hasCompleteVerificationEvidence =
        input.verificationEvidenceVersion === 1 &&
        typeof input.verificationEvidenceDigest === 'string' &&
        input.verificationEvidenceDigest.length > 0 &&
        input.verificationStatus !== undefined;
    const hasAnyVerificationEvidence =
        input.verificationEvidenceVersion !== undefined ||
        input.verificationEvidenceDigest !== undefined ||
        input.verificationStatus !== undefined;
    const progressComplete =
        run.nextStepSequence === run.totalSteps &&
        run.notStartedSteps === 0 &&
        run.appliedSteps + run.failedSteps + run.skippedSteps === run.totalSteps &&
        run.completedMutationSteps === run.appliedSteps;
    if (
        (status === 'succeeded' &&
            (!progressComplete ||
                run.failedSteps !== 0 ||
                input.verificationStatus !== 'matched' ||
                !hasCompleteVerificationEvidence)) ||
        (status === 'needs_reconciliation' &&
            (!progressComplete ||
                !['mismatch', 'read_failed'].includes(input.verificationStatus ?? '') ||
                !hasCompleteVerificationEvidence)) ||
        (preservesVerificationEvidence ? !hasCompleteVerificationEvidence : hasAnyVerificationEvidence) ||
        (status === 'failed_before_mutation' &&
            (run.appliedSteps !== 0 || run.completedMutationSteps !== 0 || run.nextStepSequence > run.failedSteps)) ||
        (status === 'partially_applied' && run.appliedSteps === 0) ||
        (status === 'outcome_unknown' && !input.errorType)
    ) {
        throw new Error('blueprint-run-terminal-progress-invalid');
    }
}

export function resolveBlueprintRunTerminalOutcome(input: {
    controlRequest?: 'pause' | 'cancel';
    forcedErrorType?: string;
    requestedErrorType?: string;
    requestedStatus: BlueprintRunTerminalStatus;
    runStatus: string;
}) {
    const status = resolveBlueprintRunFinalizationStatus(input);
    return {
        ...(input.forcedErrorType || input.requestedErrorType
            ? { errorType: input.forcedErrorType ?? input.requestedErrorType }
            : {}),
        preservesVerificationEvidence: status === 'succeeded' || status === 'needs_reconciliation',
        status,
    };
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
    status: BlueprintRunTerminalStatus;
    terminalDigest: string;
    terminalRequestDigest: string;
    verificationEvidenceDigest?: string;
    verificationEvidenceVersion?: 1;
    verificationStatus?: 'matched' | 'mismatch' | 'read_failed';
}) {
    return {
        completedAt: input.now,
        controlRequest: undefined,
        errorType: input.errorType,
        status: input.status,
        leaseExpiresAt: undefined,
        leaseId: undefined,
        leaseOwner: undefined,
        phase: 'complete' as const,
        terminalDigest: input.terminalDigest,
        terminalRequestDigest: input.terminalRequestDigest,
        retryAt: undefined,
        updatedAt: input.now,
        verificationEvidenceDigest: input.verificationEvidenceDigest,
        verificationEvidenceVersion: input.verificationEvidenceDigest
            ? (input.verificationEvidenceVersion ?? (1 as const))
            : undefined,
        verificationStatus: input.verificationStatus,
    };
}

export async function createBlueprintRunTerminalDigestForRecord(input: {
    errorType?: string;
    run: Pick<
        Doc<'blueprintRuns'>,
        | '_id'
        | 'appliedSteps'
        | 'completedMutationSteps'
        | 'failedSteps'
        | 'nextStepSequence'
        | 'notStartedSteps'
        | 'skippedSteps'
        | 'totalSteps'
        | 'totalMutationSteps'
        | 'restorePointBackupId'
        | 'restorePointSnapshotDigest'
        | 'terminalRequestDigest'
    >;
    status: BlueprintRunTerminalStatus;
    terminalRequestDigest: string;
    verificationEvidenceDigest?: string;
    verificationStatus?: 'matched' | 'mismatch' | 'read_failed';
}): Promise<string> {
    return createBlueprintRunTerminalDigest({
        runId: String(input.run._id),
        terminalRequestDigest: input.terminalRequestDigest,
        status: input.status,
        errorType: input.errorType ?? null,
        restorePointBackupId: input.run.restorePointBackupId ?? null,
        restorePointSnapshotDigest: input.run.restorePointSnapshotDigest ?? null,
        verificationStatus: input.verificationStatus ?? null,
        verificationEvidenceDigest: input.verificationEvidenceDigest ?? null,
        progress: {
            appliedSteps: input.run.appliedSteps,
            completedMutationSteps: input.run.completedMutationSteps,
            failedSteps: input.run.failedSteps,
            nextStepSequence: input.run.nextStepSequence,
            notStartedSteps: input.run.notStartedSteps,
            skippedSteps: input.run.skippedSteps,
            totalSteps: input.run.totalSteps,
            totalMutationSteps: input.run.totalMutationSteps,
        },
    });
}

export function createBlueprintRunTerminalRequestDigestForRecord(input: {
    errorType?: string;
    requestedStatus: BlueprintRunTerminalStatus;
    runId: string;
    sourceDigest?: string;
    verificationEvidenceDigest?: string;
    verificationResult?: unknown;
    verificationStatus?: 'matched' | 'mismatch' | 'read_failed';
}): Promise<string> {
    return createBlueprintRunTerminalRequestDigest({
        runId: input.runId,
        requestedStatus: input.requestedStatus,
        errorType: input.errorType ?? null,
        sourceDigest: input.sourceDigest ?? null,
        verificationEvidenceDigest: input.verificationEvidenceDigest ?? null,
        verificationResult: input.verificationResult ?? null,
        verificationStatus: input.verificationStatus ?? null,
    });
}

export { createBlueprintRunTerminalSourceDigest };

export async function createBlueprintRunControlCancellationRequestDigest(runId: string): Promise<string> {
    return createBlueprintRunTerminalRequestDigestForRecord({
        runId,
        requestedStatus: 'cancelled',
        sourceDigest: await createBlueprintRunTerminalSourceDigest({
            kind: 'control_request',
            identity: { request: 'cancel' },
        }),
    });
}

export async function resolveBlueprintRunTerminalRetryRequestDigest(input: {
    requestedTerminalRequestDigest: string;
    runId: string;
    status: BlueprintRunTerminalStatus;
    storedTerminalRequestDigest: string | undefined;
}): Promise<string> {
    if (input.status === 'cancelled') {
        const cancellationRequestDigest = await createBlueprintRunControlCancellationRequestDigest(input.runId);
        if (input.storedTerminalRequestDigest === cancellationRequestDigest) return cancellationRequestDigest;
    }
    return input.requestedTerminalRequestDigest;
}

export async function assertBlueprintRunTerminalRecordInvariant(input: {
    expectedTerminalRequestDigest?: string;
    evidence: Doc<'blueprintRunVerificationEvidence'> | null;
    run: Doc<'blueprintRuns'>;
    status: BlueprintRunTerminalStatus;
}): Promise<void> {
    const { run, status } = input;
    if (
        run.status !== status ||
        !run.terminalDigest ||
        !run.terminalRequestDigest ||
        (input.expectedTerminalRequestDigest !== undefined &&
            run.terminalRequestDigest !== input.expectedTerminalRequestDigest)
    ) {
        throw new Error('blueprint-run-finalization-conflict');
    }
    assertBlueprintRunTerminalInvariant({
        run,
        status,
        ...(run.errorType ? { errorType: run.errorType } : {}),
        ...(run.verificationEvidenceDigest
            ? {
                  verificationEvidenceDigest: run.verificationEvidenceDigest,
                  verificationEvidenceVersion: run.verificationEvidenceVersion,
                  verificationStatus: run.verificationStatus,
              }
            : {}),
    });
    const expectedTerminalDigest = await createBlueprintRunTerminalDigestForRecord({
        run,
        status,
        terminalRequestDigest: run.terminalRequestDigest,
        ...(run.errorType ? { errorType: run.errorType } : {}),
        ...(run.verificationEvidenceDigest
            ? {
                  verificationEvidenceDigest: run.verificationEvidenceDigest,
                  verificationStatus: run.verificationStatus,
              }
            : {}),
    });
    if (expectedTerminalDigest !== run.terminalDigest) {
        throw new Error('blueprint-run-finalization-conflict');
    }

    const preservesVerificationEvidence = status === 'succeeded' || status === 'needs_reconciliation';
    if (!preservesVerificationEvidence) {
        if (input.evidence) throw new Error('blueprint-run-finalization-conflict');
        return;
    }
    const integrity = input.evidence
        ? await validateBlueprintRunVerificationEvidenceIntegrity({
              version: input.evidence.version,
              runId: String(input.evidence.runId),
              planId: String(input.evidence.planId),
              verificationStatus: input.evidence.verificationStatus,
              result: input.evidence.result as unknown,
              verificationEvidenceDigest: input.evidence.verificationEvidenceDigest,
              createdAt: input.evidence.createdAt,
          })
        : undefined;
    if (
        integrity?.type !== 'valid' ||
        integrity.value.runId !== String(run._id) ||
        integrity.value.planId !== String(run.planId) ||
        integrity.value.verificationStatus !== run.verificationStatus ||
        integrity.value.verificationEvidenceDigest !== run.verificationEvidenceDigest
    ) {
        throw new Error('blueprint-run-finalization-conflict');
    }
}
