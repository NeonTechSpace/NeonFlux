import '@tanstack/react-start/server-only';

import {
    findActiveBlueprintRun,
    getBlueprintPlanMetadata,
    listBlueprintPlanStepsByPlanIdPage,
    listBlueprintPlanSummariesByGuildId,
    listLatestBlueprintPlanPreflightSummaries,
    listLatestBlueprintRunSummaries,
} from '@neonflux/db';

import { getWebDb } from './db.server.js';
import { loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import type {
    DashboardBlueprintPlanStepPageInput,
    DashboardBlueprintPlanStepPageResult,
    DashboardBlueprintRunsResult,
    DashboardBlueprintStatusResult,
} from './dashboard-blueprint-model.js';
import {
    mapRepositoryError,
    toDashboardRun,
    toDashboardPlanStep,
    toDashboardBlueprintPlan,
    toDashboardPlanPreflight,
} from './dashboard-blueprint-records.server.js';

export async function loadDashboardBlueprintStatus(
    request: Request,
    guildId: string
): Promise<DashboardBlueprintStatusResult> {
    const context = await loadAuthorizedBlueprintContext(request, guildId);
    if (context.type !== 'authorized') return context;
    const database = await getWebDb();
    const runResult = await findActiveBlueprintRun(database.db, { guildId: context.guild.id });
    if (runResult.isErr()) return { type: 'database-error' };
    if (!runResult.value) return { type: 'status' };
    return {
        type: 'status',
        activePlan: { id: runResult.value.planId, run: toDashboardRun(runResult.value) },
    };
}

export async function loadDashboardBlueprintRuns(
    request: Request,
    guildId: string
): Promise<DashboardBlueprintRunsResult> {
    const context = await loadAuthorizedBlueprintContext(request, guildId);
    if (context.type !== 'authorized') return context;
    const database = await getWebDb();

    // History deliberately has three bounded dependencies: plan metadata, preflight metadata, and hot runs.
    const plansResult = await listBlueprintPlanSummariesByGuildId(database.db, {
        guildId: context.guild.id,
        limit: 20,
    });
    if (plansResult.isErr()) return { type: 'database-error' };
    const plans = plansResult.value;
    const planIds = plans.map((plan) => plan.id);
    if (planIds.length === 0) {
        return { type: 'runs', targetGuildName: context.guild.name, plans: [] };
    }
    const [preflights, runs] = await Promise.all([
        listLatestBlueprintPlanPreflightSummaries(database.db, { guildId: context.guild.id, planIds }),
        listLatestBlueprintRunSummaries(database.db, { guildId: context.guild.id, planIds }),
    ]);
    if (preflights.isErr() || runs.isErr()) return { type: 'database-error' };

    return {
        type: 'runs',
        targetGuildName: context.guild.name,
        plans: plans.map((plan) => {
            const preflight = preflights.value[plan.id];
            const run = runs.value[plan.id];
            const recoveryAvailable =
                run !== null && ['partially_applied', 'needs_reconciliation', 'outcome_unknown'].includes(run.status);
            return {
                ...toDashboardBlueprintPlan(plan),
                ...(preflight ? { preflight: toDashboardPlanPreflight(preflight) } : {}),
                ...(run ? { run: toDashboardRun(run) } : {}),
                ...(recoveryAvailable ? { recoveryAvailable: true } : {}),
            };
        }),
    };
}

export async function readDashboardBlueprintPlanStepPage(
    request: Request,
    input: DashboardBlueprintPlanStepPageInput
): Promise<DashboardBlueprintPlanStepPageResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const planId = input.planId.trim();
    if (!planId) return { type: 'invalid-input', message: 'Choose a Blueprint plan.' };
    const database = await getWebDb();
    const planResult = await getBlueprintPlanMetadata(database.db, {
        guildId: context.guild.id,
        planId,
    });
    if (planResult.isErr()) return mapRepositoryError(planResult.error);
    const pageResult = await listBlueprintPlanStepsByPlanIdPage(database.db, {
        cursor: input.cursor,
        guildId: context.guild.id,
        limit: input.limit,
        planId,
    });
    if (pageResult.isErr()) return mapRepositoryError(pageResult.error);
    return {
        type: 'plan-step-page',
        page: {
            steps: pageResult.value.steps.map(toDashboardPlanStep),
            ...(pageResult.value.nextCursor ? { nextCursor: pageResult.value.nextCursor } : {}),
        },
    };
}
