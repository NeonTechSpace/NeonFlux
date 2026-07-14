import '@tanstack/react-start/server-only';

import type {
    StructureBackupRecord,
    StructureBackupSettingsRecord,
    StructureBackupSummaryPageRecord,
    StructureBackupSummaryRecord,
    StructureImportActionRecord,
    StructureImportExecutionRecord,
    StructureImportPreflightRecord,
    StructureImportRunRecord,
    StructureImportRunWithActionsRecord,
    StructureObservedEventStateRecord,
} from '@neonflux/db';

import type { AuthorizedStructureContext } from './dashboard-structure-context.server.js';
import { normalizeDashboardStructureSnapshot } from './dashboard-structure-diff.js';
import type { DashboardStructurePlan, DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import type { DashboardStructurePreflightReport } from './dashboard-structure-preflight.js';
import {
    createEmptyDecisionSummary,
    dashboardStructureExecutionPhases,
    isDashboardStructurePolicy,
} from './dashboard-structure-contracts.js';
import type {
    DashboardStructureDecisionSummary,
    DashboardStructureExecutionProgress,
    DashboardStructurePersistedPreflight,
    DashboardStructurePolicy,
} from './dashboard-structure-contracts.js';
import type {
    DashboardStructureBackupPage,
    DashboardStructureBackupSettings,
    DashboardStructureBackupSummary,
    DashboardStructureErrorResult,
    DashboardStructureImportAction,
    DashboardStructureImportRun,
    DashboardStructureJsonRecord,
    DashboardStructureObservedState,
    DashboardStructureScheduledDriftStatus,
} from './dashboard-structure-model.js';

export const dashboardImportActionInlineLimit = 100;

export type StructureAuditPayload = {
    action: string;
    actorUserId: string;
    metadata: Record<string, unknown>;
    targetId?: string;
};

export function createStructureAuditPayload(
    context: AuthorizedStructureContext,
    action: string,
    targetId: string | undefined,
    metadata: Record<string, unknown>
): StructureAuditPayload {
    return {
        action,
        actorUserId: context.actor.actorUserId,
        metadata: { source: 'dashboard', ...metadata, ...context.actor.metadata },
        ...(targetId ? { targetId } : {}),
    };
}

export function toDashboardBackupPage(record: StructureBackupSummaryPageRecord): DashboardStructureBackupPage {
    return {
        backups: record.backups.map(toDashboardBackupSummary),
        ...(record.nextCursor ? { nextCursor: record.nextCursor } : {}),
    };
}

export function toDashboardBackupSummary(
    record: StructureBackupRecord | StructureBackupSummaryRecord
): DashboardStructureBackupSummary {
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

export function toDashboardBackupSettings(record: StructureBackupSettingsRecord): DashboardStructureBackupSettings {
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
): DashboardStructureScheduledDriftStatus | undefined {
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

export function toDashboardImportRun(
    record: StructureImportRunRecord | StructureImportRunWithActionsRecord
): DashboardStructureImportRun {
    const actions = 'actions' in record ? record.actions : [];
    const summary = readPlanSummary(record.plan);
    const requestedSnapshot = readRequestedSnapshot(record.plan);
    const requestedSnapshotStoredAt = readRequestedSnapshotStoredAt(record.plan);
    const policy = readPolicy(record.plan);
    if (!policy || record.plan.planVersion !== 3) throw new Error('invalid-server-blueprint-v3-plan');
    const decisionSummary = readDecisionSummary(record.plan);
    const planDigest = typeof record.plan.planDigest === 'string' ? record.plan.planDigest : '';
    if (!planDigest) throw new Error('invalid-server-blueprint-v3-digest');
    const actionCount = summary.creates + summary.updates + summary.deletes;
    const executionActionCount = readExecutionActionCount(record.plan);
    const planBlockerCount = Array.isArray(record.plan.blockers) ? record.plan.blockers.length : 1;
    return {
        id: record.id,
        status: record.status,
        ...(record.createdByUserId ? { createdByUserId: record.createdByUserId } : {}),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        summary,
        actionCount,
        executionActionCount,
        planBlockerCount,
        actions: shouldInlineImportActions(executionActionCount, actions) ? actions.map(toDashboardImportAction) : [],
        ...(requestedSnapshot ? { requestedSnapshot } : {}),
        ...(requestedSnapshot && requestedSnapshotStoredAt ? { requestedSnapshotStoredAt } : {}),
        policy,
        decisionSummary,
        decisions: [],
        planDigest,
        deleteActionCount: record.deleteActionCount,
        ...(record.deleteSetDigest ? { deleteSetDigest: record.deleteSetDigest } : {}),
    };
}

export function toDashboardPreflight(
    record: StructureImportPreflightRecord
): DashboardStructurePersistedPreflight & { report: DashboardStructurePreflightReport } {
    const report = record.report as DashboardStructurePreflightReport;
    const blockerCount =
        report.summary.stale + report.summary.mappingRequired + report.summary.unsupported + report.summary.invalidPlan;
    return {
        checkedAt: record.checkedAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        digest: record.preflightDigest,
        status: record.status === 'ready' ? 'ready' : 'blocked',
        blockerCount,
        report,
    };
}

export function toDashboardExecution(record: StructureImportExecutionRecord): DashboardStructureExecutionProgress {
    if (!dashboardStructureExecutionPhases.includes(record.phase)) {
        throw new Error('invalid-server-blueprint-execution-phase');
    }
    const phase = record.phase;
    return {
        id: record.id,
        protocolVersion: record.protocolVersion,
        status: record.status,
        phase,
        completedActions: record.appliedActions + record.failedActions + record.skippedActions,
        failedActions: record.failedActions,
        totalActions: record.totalActions,
        ...(record.currentActionLabel ? { currentActionLabel: record.currentActionLabel } : {}),
        ...(record.retryAt ? { retryAt: record.retryAt.toISOString() } : {}),
        ...(record.errorType ? { errorType: record.errorType } : {}),
        ...(record.restorePointBackupId ? { restorePointBackupId: record.restorePointBackupId } : {}),
        createdAt: record.createdAt.toISOString(),
        ...(record.startedAt ? { startedAt: record.startedAt.toISOString() } : {}),
        updatedAt: record.updatedAt.toISOString(),
        ...(record.completedAt ? { completedAt: record.completedAt.toISOString() } : {}),
    };
}

export function toDashboardImportAction(record: StructureImportActionRecord): DashboardStructureImportAction {
    const details = toJsonRecord(record.details);
    const label = typeof details.label === 'string' ? details.label : undefined;
    return {
        id: record.id,
        sequence: record.sequence,
        actionType: record.actionType,
        targetType: record.targetType,
        ...(record.targetId ? { targetId: record.targetId } : {}),
        ...(label ? { label } : {}),
        details,
    };
}

export function toDashboardObservedState(
    record: StructureObservedEventStateRecord,
    settings: StructureBackupSettingsRecord
): DashboardStructureObservedState {
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

export function readRequestedSnapshot(plan: Record<string, unknown>): DashboardStructureSnapshot | undefined {
    if (plan.requestedSnapshotVersion !== 1) return undefined;
    const result = normalizeDashboardStructureSnapshot(plan.requestedSnapshot);
    return result.type === 'valid' ? result.snapshot : undefined;
}

export function readPolicy(plan: Record<string, unknown>): DashboardStructurePolicy | undefined {
    return isDashboardStructurePolicy(plan.policy) ? plan.policy : undefined;
}

export function summarizeActions(actions: StructureImportActionRecord[]): DashboardStructurePlan['summary'] {
    return {
        creates: actions.filter((action) => action.actionType === 'create').length,
        updates: actions.filter((action) => action.actionType === 'update').length,
        deletes: actions.filter((action) => action.actionType === 'delete').length,
        roles: actions.filter((action) => action.targetType === 'role').length,
        categories: actions.filter((action) => action.targetType === 'category').length,
        channels: actions.filter((action) => action.targetType === 'channel').length,
    };
}

export function mapRepositoryError(error: { type: string }): DashboardStructureErrorResult {
    return error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
}

export function toJsonRecord(value: unknown): DashboardStructureJsonRecord {
    return JSON.parse(JSON.stringify(value)) as DashboardStructureJsonRecord;
}

function shouldInlineImportActions(executionActionCount: number, actions: StructureImportActionRecord[]): boolean {
    return (
        actions.length > 0 &&
        actions.length === executionActionCount &&
        actions.length <= dashboardImportActionInlineLimit
    );
}

function readExecutionActionCount(plan: Record<string, unknown>): number {
    const count = plan.executionActionCount;
    if (!Number.isInteger(count) || typeof count !== 'number' || count < 0) {
        throw new Error('invalid-server-blueprint-v3-execution-count');
    }
    return count;
}

function readPlanSummary(plan: Record<string, unknown>): DashboardStructurePlan['summary'] {
    const summary = isObject(plan.summary) ? plan.summary : {};
    return {
        creates: readNumber(summary.creates),
        updates: readNumber(summary.updates),
        deletes: readNumber(summary.deletes),
        roles: readNumber(summary.roles),
        categories: readNumber(summary.categories),
        channels: readNumber(summary.channels),
    };
}

function readRequestedSnapshotStoredAt(plan: Record<string, unknown>): string | undefined {
    return typeof plan.requestedSnapshotStoredAt === 'string' && plan.requestedSnapshotStoredAt.trim()
        ? plan.requestedSnapshotStoredAt.trim()
        : undefined;
}

function readDecisionSummary(plan: Record<string, unknown>): DashboardStructureDecisionSummary {
    if (!isObject(plan.decisionSummary)) throw new Error('invalid-server-blueprint-decision-summary');
    const summary = createEmptyDecisionSummary();
    for (const classification of Object.keys(summary) as Array<keyof DashboardStructureDecisionSummary>) {
        summary[classification] = readNonNegativeNumber(plan.decisionSummary[classification]);
    }
    return summary;
}

function readPlanSummaryRecord(value: Record<string, unknown> | null): DashboardStructurePlan['summary'] | undefined {
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

function readNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
