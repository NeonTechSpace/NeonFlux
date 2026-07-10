import '@tanstack/react-start/server-only';

import { findLatestStructureImportExecution, findStructureImportRunWithActionsByGuildId } from '@neonflux/db';

import { getWebDb } from './db.server.js';

const recoverableExecutionStatuses = ['partially_applied', 'needs_reconciliation', 'outcome_unknown'] as const;

export async function loadDashboardStructureRecoverySource(guildId: string, runId: string) {
    const database = await getWebDb();
    const run = await findStructureImportRunWithActionsByGuildId(database.db, { guildId, runId });
    if (run.isErr())
        return run.error.type === 'not-found'
            ? ({ type: 'not-found' } as const)
            : ({ type: 'database-error' } as const);

    const execution = await findLatestStructureImportExecution(database.db, { guildId, runId });
    if (execution.isErr()) return { type: 'database-error' as const };
    const value = execution.value;
    const verificationFailed = value?.verificationStatus === 'mismatch' || value?.verificationStatus === 'read-failed';
    if (!value || (!recoverableExecutionStatuses.includes(value.status as never) && !verificationFailed)) {
        return { type: 'not-recoverable' as const, status: value?.status ?? 'not-started' };
    }
    return { type: 'source' as const, run: run.value, execution: value };
}

export function createDashboardStructureRecoveryMetadata(runId: string, executionId: string) {
    return { sourceRunId: runId, sourceExecutionId: executionId };
}
