import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import { findStructureImportRunByGuildId } from '@neonflux/db';
import type { StructureImportActionRecord } from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';

import { getWebDatabaseClient } from './database.server.js';
import { loadAuthorizedStructureContext, recordStructureAudit } from './dashboard-structure-context.server.js';
import type { DashboardStructureErrorResult } from './dashboard-structure-context.server.js';
import { toDashboardStructureSnapshot } from './dashboard-structure-diff.js';
import { preflightDashboardStructureImportPlan } from './dashboard-structure-preflight.js';
import type {
    DashboardStructurePreflightInputAction,
    DashboardStructurePreflightReport,
} from './dashboard-structure-preflight.js';

export type DashboardStructurePreflightInput = {
    guildId: string;
    importRunId: string;
};

export type DashboardStructurePreflightResult =
    | {
          type: 'preflight';
          importRunId: string;
          report: DashboardStructurePreflightReport;
      }
    | { type: 'invalid-input'; message: string }
    | { type: 'not-preflightable'; status: string }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

export async function preflightDashboardStructureImportRun(
    request: Request,
    input: DashboardStructurePreflightInput
): Promise<DashboardStructurePreflightResult> {
    const context = await loadAuthorizedStructureContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const importRunId = input.importRunId.trim();

    if (!importRunId) {
        return { type: 'invalid-input', message: 'Choose a confirmed import dry-run to preflight.' };
    }

    const database = getWebDatabaseClient();
    const importRunResult = await findStructureImportRunByGuildId(database.db, {
        guildId: context.guild.id,
        runId: importRunId,
    });

    if (importRunResult.isErr()) return mapRepositoryError(importRunResult.error);

    if (importRunResult.value.status !== 'confirmed') {
        return { type: 'not-preflightable', status: importRunResult.value.status };
    }

    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) return { type: 'bot-token-missing' };

    const currentResult = await readFluxerBotGuildStructure({
        botToken,
        guildId: context.guild.id,
    });

    if (currentResult.isErr()) return { type: 'structure-read-failed' };

    const report = preflightDashboardStructureImportPlan(
        toDashboardStructureSnapshot(currentResult.value),
        importRunResult.value.actions.map(toPreflightAction),
        { sourceGuildId: readRequestedGuildId(importRunResult.value.plan) }
    );
    const auditResult = await recordStructureAudit(context, 'structure.import_preflight_checked', importRunId, {
        actionCount: report.summary.total,
        readyCount: report.summary.ready,
        staleCount: report.summary.stale,
        mappingRequiredCount: report.summary.mappingRequired,
        destructiveApprovalRequiredCount: report.summary.destructiveApprovalRequired,
        unsupportedCount: report.summary.unsupported,
        invalidPlanCount: report.summary.invalidPlan,
    });

    if (auditResult === 'database-error') return { type: 'database-error' };

    return {
        type: 'preflight',
        importRunId,
        report,
    };
}

function toPreflightAction(action: StructureImportActionRecord): DashboardStructurePreflightInputAction {
    const details = toJsonRecord(action.details);
    const label = typeof details.label === 'string' ? details.label : undefined;

    return {
        id: action.id,
        actionType: action.actionType,
        targetType: action.targetType,
        ...(action.targetId ? { targetId: action.targetId } : {}),
        ...(label ? { label } : {}),
        details,
    };
}

function mapRepositoryError(error: { type: string }): DashboardStructureErrorResult {
    return error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
}

function toJsonRecord(value: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function readRequestedGuildId(plan: Record<string, unknown>): string | undefined {
    return typeof plan.requestedGuildId === 'string' && plan.requestedGuildId.trim()
        ? plan.requestedGuildId.trim()
        : undefined;
}
