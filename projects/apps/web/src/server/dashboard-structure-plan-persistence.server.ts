import '@tanstack/react-start/server-only';

import {
    createStructureImportRun,
    findStructureImportRunByGuildId,
    listStructureImportDecisionsPage,
    recordStructureImportActionsBatch,
    recordStructureImportDecisionsBatch,
    structureImportRunStatuses,
    transitionStructureImportPlanState,
} from '@neonflux/db';
import type { StructureImportActionRecord } from '@neonflux/db';

import { getWebDb } from './db.server.js';
import { structurePlanDigest } from './dashboard-structure-apply-plan.js';
import { loadAuthorizedStructureContext } from './dashboard-structure-context.server.js';
import type { AuthorizedStructureContext } from './dashboard-structure-context.server.js';
import type { DashboardStructurePlan, DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import { createEmptyDecisionSummary } from './dashboard-structure-contracts.js';
import type {
    DashboardStructureDecisionSummary,
    DashboardStructurePolicy,
    DashboardStructureReviewDecision,
} from './dashboard-structure-contracts.js';
import type { DashboardStructureErrorResult, DashboardStructurePlanResult } from './dashboard-structure-model.js';
import {
    dashboardImportActionInlineLimit,
    toDashboardImportRun,
    toJsonRecord,
} from './dashboard-structure-records.server.js';
import type { StructureAuditPayload } from './dashboard-structure-records.server.js';

export type DashboardStructureDecisionPageInput = {
    cursor?: number;
    guildId: string;
    importRunId: string;
    limit?: number;
};

export type DashboardStructureDecisionPageResult =
    | { type: 'decision-page'; decisions: DashboardStructureReviewDecision[]; nextCursor?: number }
    | { type: 'invalid-input'; message: string }
    | DashboardStructureErrorResult;

export function createDashboardStructurePlanDigests(
    plan: DashboardStructurePlan,
    requested: DashboardStructureSnapshot
) {
    const deleteActions = plan.executionActions.filter((action) => action.actionType === 'delete');
    return {
        planDigest: structurePlanDigest(plan.fingerprintInput),
        requestedSnapshotDigest: structurePlanDigest(requested),
        deleteActionCount: deleteActions.length,
        deleteSetDigest:
            deleteActions.length > 0
                ? structurePlanDigest(
                      deleteActions.map((action) => `${action.targetType}:${action.targetId ?? ''}`).sort()
                  )
                : null,
    };
}

function materializeDashboardStructureReviewDecisions(
    plan: DashboardStructurePlan,
    requested: DashboardStructureSnapshot
): DashboardStructureReviewDecision[] {
    const sourceNames = new Map(
        [...requested.roles, ...requested.categories, ...requested.channels].map((item) => [
            item.id,
            item.name ?? item.id,
        ])
    );
    const projectedNames = new Map(
        [...plan.projectedSnapshot.roles, ...plan.projectedSnapshot.categories, ...plan.projectedSnapshot.channels].map(
            (item) => [item.id, item.name ?? item.id]
        )
    );
    return plan.decisions.map((decision) => {
        const logicalId = decision.sourceId ?? decision.targetId ?? 'unknown';
        const actionLabel = plan.actions.find(
            (action) => action.targetId === decision.sourceId || action.targetId === decision.targetId
        )?.label;
        return {
            logicalId,
            targetType: decision.targetType,
            name:
                (decision.sourceId ? sourceNames.get(decision.sourceId) : undefined) ??
                (decision.targetId ? projectedNames.get(decision.targetId) : undefined) ??
                actionLabel ??
                logicalId,
            classification: decision.classification,
            ...(decision.sourceId ? { sourceId: decision.sourceId } : {}),
            ...(decision.targetId ? { targetId: decision.targetId } : {}),
            fields: decision.changes?.map((change) => change.field) ?? [],
            reason: decision.reason,
        };
    });
}

function summarizeDashboardStructureReviewDecisions(
    decisions: DashboardStructureReviewDecision[]
): DashboardStructureDecisionSummary {
    const summary = createEmptyDecisionSummary();
    for (const decision of decisions) summary[decision.classification] += 1;
    return summary;
}

export async function persistDashboardStructureImportPlan(
    context: AuthorizedStructureContext,
    plan: DashboardStructurePlan,
    requestedSnapshot: DashboardStructureSnapshot,
    options: {
        audit?: (importRunId: string) => StructureAuditPayload;
        policy: DashboardStructurePolicy;
        planMetadata?: Record<string, unknown>;
        roleMappings?: Record<string, string>;
        categoryMappings?: Record<string, string>;
        channelMappings?: Record<string, string>;
        source?: string;
        sourceBackupId?: string;
    }
): Promise<DashboardStructurePlanResult> {
    const database = await getWebDb();
    const requestedSnapshotStoredAt = new Date().toISOString();
    const { planDigest, deleteActionCount, deleteSetDigest, requestedSnapshotDigest } =
        createDashboardStructurePlanDigests(plan, requestedSnapshot);
    const reviewDecisions = materializeDashboardStructureReviewDecisions(plan, requestedSnapshot);
    const runResult = await createStructureImportRun(database.db, {
        guildId: context.guild.id,
        createdByUserId: context.actor.actorUserId,
        planVersion: 3,
        policy: options.policy,
        planDigest,
        deleteActionCount,
        ...(deleteSetDigest ? { deleteSetDigest } : {}),
        requestedSnapshotDigest,
        plan: toJsonRecord({
            summary: plan.summary,
            executionActionCount: plan.executionActions.length,
            executionActions: plan.executionActions,
            knownTargetKinds: plan.knownTargetKinds,
            sourceTargetMap: plan.sourceTargetMap,
            roleProjection: plan.roleProjection,
            ...(options.roleMappings && Object.keys(options.roleMappings).length > 0
                ? { roleMappings: options.roleMappings }
                : {}),
            ...(options.categoryMappings && Object.keys(options.categoryMappings).length > 0
                ? { categoryMappings: options.categoryMappings }
                : {}),
            ...(options.channelMappings && Object.keys(options.channelMappings).length > 0
                ? { channelMappings: options.channelMappings }
                : {}),
            requestedGuildId: requestedSnapshot.guildId ?? null,
            requestedExportedAt: requestedSnapshot.exportedAt ?? null,
            requestedSnapshot,
            requestedSnapshotStoredAt,
            requestedSnapshotVersion: 1,
            source: options.source ?? 'dashboard-json',
            ...(options.planMetadata ?? {}),
            planVersion: 3,
            policy: options.policy,
            planDigest,
            decisionSummary: summarizeDashboardStructureReviewDecisions(reviewDecisions),
            blockers: plan.blockers,
            projectedSnapshot: plan.projectedSnapshot,
            fingerprintInput: plan.fingerprintInput,
        }),
        ...(options.sourceBackupId ? { sourceBackupId: options.sourceBackupId } : {}),
    });
    if (runResult.isErr()) return { type: 'database-error' };

    const decisionRecords = await recordDashboardStructureReviewDecisions(runResult.value.id, reviewDecisions);
    if (decisionRecords === 'database-error') {
        await markStructureImportRunActionWriteFailed(runResult.value.id);
        return { type: 'database-error' };
    }
    const actionRecords = await recordActionBatches(
        runResult.value.id,
        plan.executionActions.map((action, index) => ({
            actionType: action.actionType,
            targetType: action.targetType,
            ...(action.targetId ? { targetId: action.targetId } : {}),
            sequence: index,
            details: toJsonRecord(action.details),
        }))
    );
    if (actionRecords === 'database-error') {
        await markStructureImportRunActionWriteFailed(runResult.value.id);
        return { type: 'database-error' };
    }
    const updatedRunResult = await transitionStructureImportPlanState(database.db, {
        audit: options.audit?.(runResult.value.id),
        runId: runResult.value.id,
        expectedStatus: structureImportRunStatuses.building,
        now: new Date(),
        status: structureImportRunStatuses.reviewReady,
    });
    if (updatedRunResult.isErr()) return { type: 'database-error' };
    return {
        type: 'plan-created',
        importRun: toDashboardImportRun({ ...updatedRunResult.value, actions: actionRecords }),
    };
}

async function recordActionBatches(
    runId: string,
    actions: Array<{
        actionType: string;
        details?: Record<string, unknown>;
        sequence: number;
        status?: string;
        targetId?: string;
        targetType: string;
    }>
): Promise<StructureImportActionRecord[] | 'database-error'> {
    if (actions.length === 0) return [];
    const database = await getWebDb();
    const records: StructureImportActionRecord[] = [];
    for (let index = 0; index < actions.length; index += 100) {
        const result = await recordStructureImportActionsBatch(database.db, {
            runId,
            actions: actions.slice(index, index + 100),
        });
        if (result.isErr()) return 'database-error';
        if (records.length <= dashboardImportActionInlineLimit) {
            records.push(...result.value.slice(0, dashboardImportActionInlineLimit - records.length));
        }
    }
    return records;
}

async function markStructureImportRunActionWriteFailed(runId: string): Promise<void> {
    const database = await getWebDb();
    await transitionStructureImportPlanState(database.db, {
        runId,
        expectedStatus: structureImportRunStatuses.building,
        now: new Date(),
        status: structureImportRunStatuses.stale,
    });
}

async function recordDashboardStructureReviewDecisions(
    runId: string,
    decisions: DashboardStructureReviewDecision[]
): Promise<'database-error' | void> {
    const database = await getWebDb();
    for (let offset = 0; offset < decisions.length; offset += 100) {
        const result = await recordStructureImportDecisionsBatch(database.db, {
            runId,
            now: new Date(),
            decisions: decisions.slice(offset, offset + 100).map((decision, index) => ({
                runId,
                sequence: offset + index,
                targetType: decision.targetType,
                classification: decision.classification,
                sourceId: decision.sourceId ?? null,
                targetId: decision.targetId ?? null,
                logicalId: decision.logicalId,
                name: decision.name,
                details: {
                    fields: decision.fields,
                    ...(decision.reason ? { reason: decision.reason } : {}),
                },
            })),
        });
        if (result.isErr()) return 'database-error';
    }
}

export async function readDashboardStructureImportDecisionPage(
    request: Request,
    input: DashboardStructureDecisionPageInput
): Promise<DashboardStructureDecisionPageResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const runId = input.importRunId.trim();
    if (!runId) return { type: 'invalid-input', message: 'Choose an import plan.' };
    const database = await getWebDb();
    const run = await findStructureImportRunByGuildId(database.db, { guildId: context.guild.id, runId });
    if (run.isErr()) return run.error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
    const page = await listStructureImportDecisionsPage(database.db, {
        guildId: context.guild.id,
        runId,
        cursor: input.cursor,
        limit: Math.min(Math.max(input.limit ?? 50, 1), 100),
    });
    if (page.isErr()) return page.error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
    return {
        type: 'decision-page',
        decisions: page.value.decisions.map((decision) => ({
            logicalId: decision.logicalId ?? decision.sourceId ?? decision.targetId ?? decision.id,
            targetType: decision.targetType as DashboardStructureReviewDecision['targetType'],
            name: decision.name ?? decision.logicalId ?? decision.id,
            classification: decision.classification as DashboardStructureReviewDecision['classification'],
            ...(decision.sourceId ? { sourceId: decision.sourceId } : {}),
            ...(decision.targetId ? { targetId: decision.targetId } : {}),
            fields: Array.isArray(decision.details.fields)
                ? decision.details.fields.filter((field): field is string => typeof field === 'string')
                : [],
            ...(typeof decision.details.reason === 'string' ? { reason: decision.details.reason } : {}),
        })),
        ...(page.value.nextCursor !== null ? { nextCursor: page.value.nextCursor } : {}),
    };
}
