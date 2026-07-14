import '@tanstack/react-start/server-only';

import {
    findActiveBlueprintRun,
    findLatestBlueprintRunForPlan,
    findLatestBlueprintPlanPreflight,
    findBlueprintPlanByGuildId,
    listBlueprintPlanStepsByPlanIdPage,
    listBlueprintPlansByGuildId,
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
    const plansResult = await listBlueprintPlansByGuildId(database.db, { guildId: context.guild.id, limit: 20 });
    if (plansResult.isErr()) return { type: 'database-error' };
    const planStateResults = await Promise.all(
        plansResult.value.map(async (plan) => {
            const [preflight, run] = await Promise.all([
                findLatestBlueprintPlanPreflight(database.db, { guildId: context.guild.id, planId: plan.id }),
                findLatestBlueprintRunForPlan(database.db, { guildId: context.guild.id, planId: plan.id }),
            ]);
            return { plan, preflight, run };
        })
    );
    if (planStateResults.some(({ preflight, run }) => preflight.isErr() || run.isErr())) {
        return { type: 'database-error' };
    }
    return {
        type: 'runs',
        plans: planStateResults.map(({ plan, preflight, run }) => {
            const runRecord = run.isOk() ? run.value : null;
            const recoveryAvailable =
                runRecord !== null &&
                ['partially_applied', 'needs_reconciliation', 'outcome_unknown'].includes(runRecord.status);
            return {
                ...toDashboardBlueprintPlan(plan),
                ...(preflight.isOk() && preflight.value
                    ? { preflight: toDashboardPlanPreflight(preflight.value) }
                    : {}),
                ...(runRecord ? { run: toDashboardRun(runRecord) } : {}),
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
    const planResult = await findBlueprintPlanByGuildId(database.db, {
        guildId: context.guild.id,
        planId: planId,
    });
    if (planResult.isErr()) return mapRepositoryError(planResult.error);
    const pageResult = await listBlueprintPlanStepsByPlanIdPage(database.db, {
        cursor: input.cursor,
        limit: input.limit,
        planId: planId,
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
