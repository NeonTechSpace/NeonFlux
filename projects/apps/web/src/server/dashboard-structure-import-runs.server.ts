import '@tanstack/react-start/server-only';

import {
    findActiveStructureImportExecution,
    findLatestStructureImportExecution,
    findLatestStructureImportPreflight,
    findStructureImportRunByGuildId,
    listStructureImportActionsByRunIdPage,
    listStructureImportRunsByGuildId,
} from '@neonflux/db';

import { getWebDb } from './db.server.js';
import { loadAuthorizedStructureContext } from './dashboard-structure-context.server.js';
import type {
    DashboardStructureActionPageInput,
    DashboardStructureActionPageResult,
    DashboardStructureRunsResult,
    DashboardStructureStatusResult,
} from './dashboard-structure-model.js';
import {
    mapRepositoryError,
    toDashboardExecution,
    toDashboardImportAction,
    toDashboardImportRun,
    toDashboardPreflight,
} from './dashboard-structure-records.server.js';

export async function loadDashboardStructureStatus(
    request: Request,
    guildId: string
): Promise<DashboardStructureStatusResult> {
    const context = await loadAuthorizedStructureContext(request, guildId);
    if (context.type !== 'authorized') return context;
    const database = await getWebDb();
    const executionResult = await findActiveStructureImportExecution(database.db, { guildId: context.guild.id });
    if (executionResult.isErr()) return { type: 'database-error' };
    if (!executionResult.value) return { type: 'status' };
    return {
        type: 'status',
        activeRun: { id: executionResult.value.runId, execution: toDashboardExecution(executionResult.value) },
    };
}

export async function loadDashboardStructureRuns(
    request: Request,
    guildId: string
): Promise<DashboardStructureRunsResult> {
    const context = await loadAuthorizedStructureContext(request, guildId);
    if (context.type !== 'authorized') return context;
    const database = await getWebDb();
    const runsResult = await listStructureImportRunsByGuildId(database.db, { guildId: context.guild.id, limit: 20 });
    if (runsResult.isErr()) return { type: 'database-error' };
    const runStateResults = await Promise.all(
        runsResult.value.map(async (run) => {
            const [preflight, execution] = await Promise.all([
                findLatestStructureImportPreflight(database.db, { guildId: context.guild.id, runId: run.id }),
                findLatestStructureImportExecution(database.db, { guildId: context.guild.id, runId: run.id }),
            ]);
            return { run, preflight, execution };
        })
    );
    if (runStateResults.some(({ preflight, execution }) => preflight.isErr() || execution.isErr())) {
        return { type: 'database-error' };
    }
    return {
        type: 'runs',
        importRuns: runStateResults.map(({ run, preflight, execution }) => {
            const executionRecord = execution.isOk() ? execution.value : null;
            const recoveryAvailable =
                executionRecord !== null &&
                ['partially_applied', 'needs_reconciliation', 'outcome_unknown'].includes(executionRecord.status);
            return {
                ...toDashboardImportRun(run),
                ...(preflight.isOk() && preflight.value ? { preflight: toDashboardPreflight(preflight.value) } : {}),
                ...(executionRecord ? { execution: toDashboardExecution(executionRecord) } : {}),
                ...(recoveryAvailable ? { recoveryAvailable: true } : {}),
            };
        }),
    };
}

export async function readDashboardStructureImportActionPage(
    request: Request,
    input: DashboardStructureActionPageInput
): Promise<DashboardStructureActionPageResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const importRunId = input.importRunId.trim();
    if (!importRunId) return { type: 'invalid-input', message: 'Choose an import run.' };
    const database = await getWebDb();
    const importRunResult = await findStructureImportRunByGuildId(database.db, {
        guildId: context.guild.id,
        runId: importRunId,
    });
    if (importRunResult.isErr()) return mapRepositoryError(importRunResult.error);
    const pageResult = await listStructureImportActionsByRunIdPage(database.db, {
        cursor: input.cursor,
        limit: input.limit,
        runId: importRunId,
    });
    if (pageResult.isErr()) return mapRepositoryError(pageResult.error);
    return {
        type: 'action-page',
        page: {
            actions: pageResult.value.actions.map(toDashboardImportAction),
            ...(pageResult.value.nextCursor ? { nextCursor: pageResult.value.nextCursor } : {}),
        },
    };
}
