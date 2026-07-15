import '@tanstack/react-start/server-only';

import type {
    StructureBackupRecord,
    StructureBackupSettingsRecord,
    StructureBackupSummaryPageRecord,
    StructureBackupSummaryRecord,
    BlueprintPlanStepRecord,
    BlueprintRunRecord,
    BlueprintPlanPreflightSummaryRecord,
    BlueprintPlanMetadataRecord,
    BlueprintPlanAuthorityRecord,
    StructureObservedEventStateRecord,
} from '@neonflux/db';

import type { AuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import type { DashboardBlueprintPlan as DashboardBlueprintDiffPlan } from './dashboard-blueprint-diff.js';
import { dashboardBlueprintRunPhases } from './dashboard-blueprint-contracts.js';
import type {
    DashboardBlueprintDecisionSummary,
    DashboardBlueprintRunProgress,
    DashboardBlueprintPlanPreflight,
} from './dashboard-blueprint-contracts.js';
import type {
    DashboardBlueprintBackupPage,
    DashboardBlueprintBackupSettings,
    DashboardBlueprintBackupSummary,
    DashboardBlueprintErrorResult,
    DashboardBlueprintPlanStep,
    DashboardBlueprintPlan,
    DashboardBlueprintJsonRecord,
    DashboardBlueprintObservedState,
    DashboardBlueprintScheduledDriftStatus,
} from './dashboard-blueprint-model.js';

export const dashboardPlanStepInlineLimit = 100;

export type BlueprintAuditPayload = {
    action: string;
    actorUserId: string;
    metadata: Record<string, unknown>;
    targetId?: string;
};

export function createBlueprintAuditPayload(
    context: AuthorizedBlueprintContext,
    action: string,
    targetId: string | undefined,
    metadata: Record<string, unknown>
): BlueprintAuditPayload {
    return {
        action,
        actorUserId: context.actor.actorUserId,
        metadata: { source: 'dashboard', ...metadata, ...context.actor.metadata },
        ...(targetId ? { targetId } : {}),
    };
}

export function toDashboardBackupPage(record: StructureBackupSummaryPageRecord): DashboardBlueprintBackupPage {
    return {
        backups: record.backups.map(toDashboardBackupSummary),
        ...(record.nextCursor ? { nextCursor: record.nextCursor } : {}),
    };
}

export function toDashboardBackupSummary(
    record: StructureBackupRecord | StructureBackupSummaryRecord
): DashboardBlueprintBackupSummary {
    return {
        id: record.id,
        name: record.name,
        source: record.source,
        status: record.status,
        ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
        ...(record.createdByUserId ? { createdByUserId: record.createdByUserId } : {}),
        createdAt: record.createdAt.toISOString(),
        completedAt: record.completedAt.toISOString(),
        roleCount: record.roleCount,
        categoryCount: record.categoryCount,
        channelCount: record.channelCount,
    };
}

export function toDashboardBackupSettings(record: StructureBackupSettingsRecord): DashboardBlueprintBackupSettings {
    const scheduledDrift = toDashboardScheduledDriftStatus(record);
    return {
        enabled: record.enabled,
        cadenceWeeks: record.cadenceWeeks,
        retentionDays: record.retentionDays,
        ...(record.lastAttemptAt ? { lastAttemptAt: record.lastAttemptAt.toISOString() } : {}),
        ...(record.lastSuccessAt ? { lastSuccessAt: record.lastSuccessAt.toISOString() } : {}),
        ...(record.lastErrorMessage ? { lastErrorMessage: record.lastErrorMessage } : {}),
        ...(record.nextBackupAt ? { nextBackupAt: record.nextBackupAt.toISOString() } : {}),
        ...(record.nextDriftCheckAt ? { nextDriftCheckAt: record.nextDriftCheckAt.toISOString() } : {}),
        ...(record.nextRetentionPruneAt ? { nextRetentionPruneAt: record.nextRetentionPruneAt.toISOString() } : {}),
        ...(scheduledDrift ? { scheduledDrift } : {}),
    };
}

function toDashboardScheduledDriftStatus(
    record: StructureBackupSettingsRecord
): DashboardBlueprintScheduledDriftStatus | undefined {
    if (!record.lastDriftStatus && !record.nextDriftCheckAt) return undefined;
    const summary = readPlanSummaryRecord(record.lastDriftSummary);
    const fieldSummary = readFieldSummaryRecord(record.lastDriftFieldSummary);
    const liveCounts = readLiveCountsRecord(record.lastDriftLiveCounts);
    return {
        status: record.lastDriftStatus ?? 'pending',
        ...(record.lastDriftCheckedAt ? { checkedAt: record.lastDriftCheckedAt.toISOString() } : {}),
        ...(record.nextDriftCheckAt ? { nextCheckAt: record.nextDriftCheckAt.toISOString() } : {}),
        ...(record.lastDriftErrorMessage ? { errorMessage: record.lastDriftErrorMessage } : {}),
        ...(record.lastDriftChangeCount !== null ? { changeCount: record.lastDriftChangeCount } : {}),
        ...(record.lastDriftBaselineBackupId ? { baselineBackupId: record.lastDriftBaselineBackupId } : {}),
        ...(record.lastDriftBaselineName ? { baselineName: record.lastDriftBaselineName } : {}),
        ...(summary ? { summary } : {}),
        ...(fieldSummary ? { fieldSummary } : {}),
        ...(liveCounts ? { liveCounts } : {}),
        hasMorePreview: record.lastDriftHasMorePreview,
    };
}

export function toDashboardBlueprintPlan(
    record: BlueprintPlanMetadataRecord,
    options: { authority?: BlueprintPlanAuthorityRecord; steps?: BlueprintPlanStepRecord[] } = {}
): DashboardBlueprintPlan {
    const { authority, steps = [] } = options;
    const summary = record.summary;
    const changeCount = summary.creates + summary.updates + summary.deletes;
    return {
        id: record.id,
        status: record.status,
        ...(record.createdByUserId ? { createdByUserId: record.createdByUserId } : {}),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        summary,
        changeCount,
        planStepCount: record.stepCount,
        planBlockerCount: record.blockerCount,
        steps: shouldInlinePlanSteps(record.stepCount, steps) ? steps.map(toDashboardPlanStep) : [],
        ...(authority ? { requestedSnapshot: authority.requestedSnapshot } : {}),
        ...(authority ? { requestedSnapshotStoredAt: authority.provenance.requestedSnapshotStoredAt } : {}),
        policy: record.policy,
        decisionSummary: toDashboardDecisionSummary(record.decisionSummary),
        decisions: [],
        planDigest: record.planDigest,
        deleteStepCount: record.deleteStepCount,
        ...(record.deleteSetDigest ? { deleteSetDigest: record.deleteSetDigest } : {}),
    };
}

export function toDashboardPlanPreflight(record: BlueprintPlanPreflightSummaryRecord): DashboardBlueprintPlanPreflight {
    const blockerCount =
        record.summary.stale + record.summary.mappingRequired + record.summary.unsupported + record.summary.invalidPlan;
    return {
        id: record.id,
        checkedAt: record.checkedAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        digest: record.preflightDigest,
        status: record.status,
        blockerCount,
    };
}

export function toDashboardRun(record: BlueprintRunRecord): DashboardBlueprintRunProgress {
    if (!dashboardBlueprintRunPhases.includes(record.phase)) {
        throw new Error('invalid-server-blueprint-run-phase');
    }
    const phase = record.phase;
    return {
        id: record.id,
        protocolVersion: record.protocolVersion,
        status: record.status,
        phase,
        completedSteps: record.appliedSteps + record.failedSteps + record.skippedSteps,
        appliedSteps: record.appliedSteps,
        completedMutationSteps: record.completedMutationSteps,
        notStartedSteps: record.notStartedSteps,
        failedSteps: record.failedSteps,
        totalSteps: record.totalSteps,
        ...(record.authorizationDecision ? { authorizationDecision: record.authorizationDecision } : {}),
        ...(record.authorizationMismatch
            ? { authorizationMismatch: toDashboardAuthorizationMismatch(record.authorizationMismatch) }
            : {}),
        ...(record.currentStepLabel ? { currentStepLabel: record.currentStepLabel } : {}),
        ...(record.retryAt ? { retryAt: record.retryAt.toISOString() } : {}),
        ...(record.errorType ? { errorType: record.errorType } : {}),
        ...(record.restorePointBackupId ? { restorePointBackupId: record.restorePointBackupId } : {}),
        ...(record.verificationStatus ? { verificationStatus: record.verificationStatus } : {}),
        ...(record.verificationEvidenceDigest ? { verificationEvidenceDigest: record.verificationEvidenceDigest } : {}),
        createdAt: record.createdAt.toISOString(),
        ...(record.startedAt ? { startedAt: record.startedAt.toISOString() } : {}),
        updatedAt: record.updatedAt.toISOString(),
        ...(record.completedAt ? { completedAt: record.completedAt.toISOString() } : {}),
    };
}

function toDashboardAuthorizationMismatch(value: Record<string, unknown>) {
    const collection = (key: string) => {
        const item = value[key];
        if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
        const record = item as Record<string, unknown>;
        return {
            addedCount: readNonNegativeCount(record.addedCount),
            removedCount: readNonNegativeCount(record.removedCount),
            changedCount: readNonNegativeCount(record.changedCount),
        };
    };
    const roles = collection('roles');
    const categories = collection('categories');
    const channels = collection('channels');
    return {
        ...(roles ? { roles } : {}),
        ...(categories ? { categories } : {}),
        ...(channels ? { channels } : {}),
        ...(value.truncated === true ? { truncated: true } : {}),
    };
}

function readNonNegativeCount(value: unknown): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function toDashboardPlanStep(record: BlueprintPlanStepRecord): DashboardBlueprintPlanStep {
    const details = toJsonRecord(record.step.details);
    return {
        id: record.id,
        sequence: record.sequence,
        actionType: record.step.actionType,
        targetType: record.step.targetType,
        targetId: record.step.targetId,
        label: record.step.label,
        details,
    };
}

export function toDashboardObservedState(
    record: StructureObservedEventStateRecord,
    settings: StructureBackupSettingsRecord
): DashboardBlueprintObservedState {
    const lastObservedAt = record.lastObservedAt?.getTime() ?? 0;
    const lastBackupAt = settings.lastSuccessAt?.getTime() ?? 0;
    return {
        observedChangeCount: record.observedChangeCount,
        targetChangeCounts: record.targetChangeCounts,
        changedSinceLastBackup: lastObservedAt > lastBackupAt,
        ...(record.lastEventType ? { lastEventType: record.lastEventType } : {}),
        ...(record.lastTargetType ? { lastTargetType: record.lastTargetType } : {}),
        ...(record.lastTargetId ? { lastTargetId: record.lastTargetId } : {}),
        ...(record.lastObservedAt ? { lastObservedAt: record.lastObservedAt.toISOString() } : {}),
    };
}

export function mapRepositoryError(error: { type: string }): DashboardBlueprintErrorResult {
    return error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
}

export function toJsonRecord(value: unknown): DashboardBlueprintJsonRecord {
    return JSON.parse(JSON.stringify(value)) as DashboardBlueprintJsonRecord;
}

function shouldInlinePlanSteps(planStepCount: number, steps: BlueprintPlanStepRecord[]): boolean {
    return steps.length > 0 && steps.length === planStepCount && steps.length <= dashboardPlanStepInlineLimit;
}

function toDashboardDecisionSummary(
    summary: BlueprintPlanMetadataRecord['decisionSummary']
): DashboardBlueprintDecisionSummary {
    return {
        'no-op': summary.noOp,
        create: summary.create,
        update: summary.update,
        delete: summary.delete,
        'protected-retained': summary.protectedRetained,
        'protected-omitted': summary.protectedOmitted,
        'unmanaged-retained': summary.unmanagedRetained,
        'blocked-ambiguous': summary.blockedAmbiguous,
        'blocked-unsupported': summary.blockedUnsupported,
    };
}

function readPlanSummaryRecord(
    value: Record<string, unknown> | null
): DashboardBlueprintDiffPlan['summary'] | undefined {
    if (!value) return undefined;
    return {
        creates: readNonNegativeNumber(value.creates),
        updates: readNonNegativeNumber(value.updates),
        deletes: readNonNegativeNumber(value.deletes),
        roles: readNonNegativeNumber(value.roles),
        categories: readNonNegativeNumber(value.categories),
        channels: readNonNegativeNumber(value.channels),
    };
}

function readFieldSummaryRecord(value: Record<string, unknown> | null) {
    if (!value) return undefined;
    return {
        names: readNonNegativeNumber(value.names),
        parentMoves: readNonNegativeNumber(value.parentMoves),
        permissions: readNonNegativeNumber(value.permissions),
        positions: readNonNegativeNumber(value.positions),
        roleVisuals: readNonNegativeNumber(value.roleVisuals),
        typeChanges: readNonNegativeNumber(value.typeChanges),
    };
}

function readLiveCountsRecord(value: Record<string, unknown> | null) {
    if (!value) return undefined;
    return {
        categories: readNonNegativeNumber(value.categories),
        channels: readNonNegativeNumber(value.channels),
        roles: readNonNegativeNumber(value.roles),
    };
}

function readNonNegativeNumber(value: unknown): number {
    return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : 0;
}
