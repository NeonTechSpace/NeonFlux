import '@tanstack/react-start/server-only';

import { listLatestBlueprintRunSummaries } from '@neonflux/db';

import { getWebDb } from './db.server.js';
import { loadDashboardBlueprintPlanAuthorityDetail } from './dashboard-blueprint-plan-detail.server.js';

const recoverableRunStatuses = ['partially_applied', 'needs_reconciliation', 'outcome_unknown'] as const;

export async function loadDashboardBlueprintRecoverySource(guildId: string, planId: string) {
    const detail = await loadDashboardBlueprintPlanAuthorityDetail(guildId, planId);
    if (detail.isErr()) {
        return detail.error.type === 'not-found'
            ? ({ type: 'not-found' } as const)
            : ({ type: 'database-error' } as const);
    }
    const database = await getWebDb();
    const runs = await listLatestBlueprintRunSummaries(database.db, { guildId, planIds: [planId] });
    if (runs.isErr()) return { type: 'database-error' as const };
    const value = runs.value[planId];
    const verificationFailed = value?.verificationStatus === 'mismatch' || value?.verificationStatus === 'read_failed';
    if (!value || (!recoverableRunStatuses.includes(value.status as never) && !verificationFailed)) {
        return { type: 'not-recoverable' as const, status: value?.status ?? 'not-started' };
    }
    return { type: 'source' as const, detail: detail.value, run: value };
}

export function createDashboardBlueprintRecoveryMetadata(planId: string, runId: string) {
    return { sourcePlanId: planId, sourceRunId: runId };
}
