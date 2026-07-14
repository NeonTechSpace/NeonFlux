import '@tanstack/react-start/server-only';

import { findLatestBlueprintRunForPlan, findBlueprintPlanWithStepsByGuildId } from '@neonflux/db';

import { getWebDb } from './db.server.js';

const recoverableRunStatuses = ['partially_applied', 'needs_reconciliation', 'outcome_unknown'] as const;

export async function loadDashboardBlueprintRecoverySource(guildId: string, planId: string) {
    const database = await getWebDb();
    const planResult = await findBlueprintPlanWithStepsByGuildId(database.db, { guildId, planId });
    if (planResult.isErr())
        return planResult.error.type === 'not-found'
            ? ({ type: 'not-found' } as const)
            : ({ type: 'database-error' } as const);

    const runResult = await findLatestBlueprintRunForPlan(database.db, { guildId, planId });
    if (runResult.isErr()) return { type: 'database-error' as const };
    const value = runResult.value;
    const verificationFailed = value?.verificationStatus === 'mismatch' || value?.verificationStatus === 'read-failed';
    if (!value || (!recoverableRunStatuses.includes(value.status as never) && !verificationFailed)) {
        return { type: 'not-recoverable' as const, status: value?.status ?? 'not-started' };
    }
    return { type: 'source' as const, plan: planResult.value, run: value };
}

export function createDashboardBlueprintRecoveryMetadata(planId: string, runId: string) {
    return { sourcePlanId: planId, sourceRunId: runId };
}
