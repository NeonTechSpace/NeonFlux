import '@tanstack/react-start/server-only';

import {
    createBlueprintPlan,
    findBlueprintPlanByGuildId,
    listBlueprintPlanDecisionsPage,
    recordBlueprintPlanStepsBatch,
    recordBlueprintPlanDecisionsBatch,
    blueprintPlanStatuses,
    transitionBlueprintPlanState,
} from '@neonflux/db';
import type { BlueprintPlanStepRecord } from '@neonflux/db';
import { normalizeBlueprintPlan } from '@neonflux/blueprint/runtime-contracts';

import { getWebDb } from './db.server.js';
import { blueprintPlanDigest } from './dashboard-blueprint-apply-plan.js';
import { loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import type { AuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import type { DashboardBlueprintPlan, DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import { createEmptyDecisionSummary } from './dashboard-blueprint-contracts.js';
import type {
    DashboardBlueprintDecisionSummary,
    DashboardBlueprintPolicy,
    DashboardBlueprintPlanDecision,
} from './dashboard-blueprint-contracts.js';
import type { DashboardBlueprintErrorResult, DashboardBlueprintPlanResult } from './dashboard-blueprint-model.js';
import {
    dashboardPlanStepInlineLimit,
    toDashboardBlueprintPlan,
    toJsonRecord,
} from './dashboard-blueprint-records.server.js';
import type { BlueprintAuditPayload } from './dashboard-blueprint-records.server.js';

export type DashboardBlueprintDecisionPageInput = {
    cursor?: number;
    guildId: string;
    planId: string;
    limit?: number;
};

export type DashboardBlueprintDecisionPageResult =
    | { type: 'decision-page'; decisions: DashboardBlueprintPlanDecision[]; nextCursor?: number }
    | { type: 'invalid-input'; message: string }
    | DashboardBlueprintErrorResult;

export function createDashboardBlueprintPlanDigests(
    plan: DashboardBlueprintPlan,
    requested: DashboardBlueprintSnapshot
) {
    const deleteSteps = plan.steps.filter((step) => step.actionType === 'delete');
    return {
        planDigest: blueprintPlanDigest(plan.fingerprintInput),
        requestedSnapshotDigest: blueprintPlanDigest(requested),
        deleteStepCount: deleteSteps.length,
        deleteSetDigest:
            deleteSteps.length > 0
                ? blueprintPlanDigest(deleteSteps.map((step) => `${step.targetType}:${step.targetId}`).sort())
                : null,
    };
}

function materializeDashboardBlueprintPlanDecisions(
    plan: DashboardBlueprintPlan,
    requested: DashboardBlueprintSnapshot
): DashboardBlueprintPlanDecision[] {
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
        const changeLabel = plan.changes.find(
            (change) => change.targetId === decision.sourceId || change.targetId === decision.targetId
        )?.label;
        return {
            logicalId,
            targetType: decision.targetType,
            name:
                (decision.sourceId ? sourceNames.get(decision.sourceId) : undefined) ??
                (decision.targetId ? projectedNames.get(decision.targetId) : undefined) ??
                changeLabel ??
                logicalId,
            classification: decision.classification,
            ...(decision.sourceId ? { sourceId: decision.sourceId } : {}),
            ...(decision.targetId ? { targetId: decision.targetId } : {}),
            fields: decision.changes?.map((change) => change.field) ?? [],
            reason: decision.reason,
        };
    });
}

function summarizeDashboardBlueprintPlanDecisions(
    decisions: DashboardBlueprintPlanDecision[]
): DashboardBlueprintDecisionSummary {
    const summary = createEmptyDecisionSummary();
    for (const decision of decisions) summary[decision.classification] += 1;
    return summary;
}

export async function persistDashboardBlueprintPlan(
    context: AuthorizedBlueprintContext,
    plan: DashboardBlueprintPlan,
    requestedSnapshot: DashboardBlueprintSnapshot,
    options: {
        audit?: (planId: string) => BlueprintAuditPayload;
        policy: DashboardBlueprintPolicy;
        planMetadata?: Record<string, unknown>;
        roleMappings?: Record<string, string>;
        categoryMappings?: Record<string, string>;
        channelMappings?: Record<string, string>;
        source?: string;
        sourceBackupId?: string;
    }
): Promise<DashboardBlueprintPlanResult> {
    const normalizedPlan = normalizeBlueprintPlan(plan);
    if (normalizedPlan.type === 'invalid') {
        return { type: 'invalid-input', message: normalizedPlan.message };
    }
    plan = normalizedPlan.value;
    const database = await getWebDb();
    const requestedSnapshotStoredAt = new Date().toISOString();
    const { planDigest, deleteStepCount, deleteSetDigest, requestedSnapshotDigest } =
        createDashboardBlueprintPlanDigests(plan, requestedSnapshot);
    const reviewDecisions = materializeDashboardBlueprintPlanDecisions(plan, requestedSnapshot);
    const runResult = await createBlueprintPlan(database.db, {
        guildId: context.guild.id,
        createdByUserId: context.actor.actorUserId,
        planVersion: 3,
        policy: options.policy,
        planDigest,
        deleteStepCount,
        ...(deleteSetDigest ? { deleteSetDigest } : {}),
        requestedSnapshotDigest,
        plan: toJsonRecord({
            summary: plan.summary,
            planStepCount: plan.steps.length,
            steps: plan.steps,
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
            decisionSummary: summarizeDashboardBlueprintPlanDecisions(reviewDecisions),
            blockers: plan.blockers,
            projectedSnapshot: plan.projectedSnapshot,
            fingerprintInput: plan.fingerprintInput,
        }),
        ...(options.sourceBackupId ? { sourceBackupId: options.sourceBackupId } : {}),
    });
    if (runResult.isErr()) return { type: 'database-error' };

    const decisionRecords = await recordDashboardBlueprintPlanDecisions(runResult.value.id, reviewDecisions);
    if (decisionRecords === 'database-error') {
        await markBlueprintPlanStepWriteFailed(runResult.value.id);
        return { type: 'database-error' };
    }
    const stepRecords = await recordPlanStepBatches(
        runResult.value.id,
        plan.steps.map((step, index) => ({
            actionType: step.actionType,
            targetType: step.targetType,
            ...(step.targetId ? { targetId: step.targetId } : {}),
            sequence: index,
            details: toJsonRecord(step.details),
        }))
    );
    if (stepRecords === 'database-error') {
        await markBlueprintPlanStepWriteFailed(runResult.value.id);
        return { type: 'database-error' };
    }
    const updatedRunResult = await transitionBlueprintPlanState(database.db, {
        audit: options.audit?.(runResult.value.id),
        planId: runResult.value.id,
        expectedStatus: blueprintPlanStatuses.draft,
        now: new Date(),
        status: blueprintPlanStatuses.reviewReady,
    });
    if (updatedRunResult.isErr()) return { type: 'database-error' };
    return {
        type: 'plan-created',
        plan: toDashboardBlueprintPlan({ ...updatedRunResult.value, steps: stepRecords }),
    };
}

async function recordPlanStepBatches(
    planId: string,
    actions: Array<{
        actionType: string;
        details?: Record<string, unknown>;
        sequence: number;
        status?: string;
        targetId?: string;
        targetType: string;
    }>
): Promise<BlueprintPlanStepRecord[] | 'database-error'> {
    if (actions.length === 0) return [];
    const database = await getWebDb();
    const records: BlueprintPlanStepRecord[] = [];
    for (let index = 0; index < actions.length; index += 100) {
        const result = await recordBlueprintPlanStepsBatch(database.db, {
            planId,
            steps: actions.slice(index, index + 100),
        });
        if (result.isErr()) return 'database-error';
        if (records.length <= dashboardPlanStepInlineLimit) {
            records.push(...result.value.slice(0, dashboardPlanStepInlineLimit - records.length));
        }
    }
    return records;
}

async function markBlueprintPlanStepWriteFailed(planId: string): Promise<void> {
    const database = await getWebDb();
    await transitionBlueprintPlanState(database.db, {
        planId,
        expectedStatus: blueprintPlanStatuses.draft,
        now: new Date(),
        status: blueprintPlanStatuses.obsolete,
    });
}

async function recordDashboardBlueprintPlanDecisions(
    planId: string,
    decisions: DashboardBlueprintPlanDecision[]
): Promise<'database-error' | void> {
    const database = await getWebDb();
    for (let offset = 0; offset < decisions.length; offset += 100) {
        const result = await recordBlueprintPlanDecisionsBatch(database.db, {
            planId,
            now: new Date(),
            decisions: decisions.slice(offset, offset + 100).map((decision, index) => ({
                planId,
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

export async function readDashboardBlueprintPlanDecisionPage(
    request: Request,
    input: DashboardBlueprintDecisionPageInput
): Promise<DashboardBlueprintDecisionPageResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const planId = input.planId.trim();
    if (!planId) return { type: 'invalid-input', message: 'Choose a Blueprint plan.' };
    const database = await getWebDb();
    const run = await findBlueprintPlanByGuildId(database.db, { guildId: context.guild.id, planId });
    if (run.isErr()) return run.error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
    const page = await listBlueprintPlanDecisionsPage(database.db, {
        guildId: context.guild.id,
        planId,
        cursor: input.cursor,
        limit: Math.min(Math.max(input.limit ?? 50, 1), 100),
    });
    if (page.isErr()) return page.error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
    return {
        type: 'decision-page',
        decisions: page.value.decisions.map((decision) => ({
            logicalId: decision.logicalId ?? decision.sourceId ?? decision.targetId ?? decision.id,
            targetType: decision.targetType as DashboardBlueprintPlanDecision['targetType'],
            name: decision.name ?? decision.logicalId ?? decision.id,
            classification: decision.classification as DashboardBlueprintPlanDecision['classification'],
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
