import '@tanstack/react-start/server-only';

import {
    findStructureImportRunByGuildId,
    listStructureImportDecisionsPage,
    recordStructureImportDecisionsBatch,
} from '@neonflux/db';

import { getWebDb } from './db.server.js';
import { structurePlanDigest } from './dashboard-structure-apply-plan.js';
import { loadAuthorizedStructureContext } from './dashboard-structure-context.server.js';
import type { DashboardStructureErrorResult } from './dashboard-structure-context.server.js';
import type { DashboardStructurePlan, DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import { createEmptyDecisionSummary } from './dashboard-structure-v2.js';
import type { DashboardStructureDecisionSummary, DashboardStructureReviewDecision } from './dashboard-structure-v2.js';

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
    const deleteActions = plan.actions.filter((action) => action.actionType === 'delete');
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

export function materializeDashboardStructureReviewDecisions(
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

export function summarizeDashboardStructureReviewDecisions(
    decisions: DashboardStructureReviewDecision[]
): DashboardStructureDecisionSummary {
    const summary = createEmptyDecisionSummary();
    for (const decision of decisions) summary[decision.classification] += 1;
    return summary;
}

export async function recordDashboardStructureReviewDecisions(
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
