import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    findStructureImportRunWithActionsByGuildId,
    recordStructureImportPreflight,
    structureAuditActions,
    structureImportRunStatuses,
} from '@neonflux/db';
import type { StructureImportActionRecord } from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';

import { getWebDb } from './db.server.js';
import { createStructureAuditInput, loadAuthorizedStructureContext } from './dashboard-structure-context.server.js';
import type { DashboardStructureErrorResult } from './dashboard-structure-context.server.js';
import {
    diffDashboardStructureSnapshot,
    normalizeDashboardStructureSnapshot,
    toDashboardStructureSnapshot,
} from './dashboard-structure-diff.js';
import type { DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import {
    readPersistedCategoryMappings,
    readPersistedChannelMappings,
    readPersistedRoleMappings,
    readStructurePolicy,
    structurePlanDigest,
} from './dashboard-structure-apply-plan.js';
import {
    preflightDashboardStructureImportPlan,
    isDashboardStructurePreflightReady,
    prependDashboardStructureProjectionBlocker,
} from './dashboard-structure-preflight.js';
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
          preflightDigest?: string;
          checkedAt?: string;
          expiresAt?: string;
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
        return { type: 'invalid-input', message: 'Choose an approved deployment plan to check.' };
    }

    const database = await getWebDb();
    const importRunResult = await findStructureImportRunWithActionsByGuildId(database.db, {
        guildId: context.guild.id,
        runId: importRunId,
    });

    if (importRunResult.isErr()) return mapRepositoryError(importRunResult.error);

    if (importRunResult.value.status !== structureImportRunStatuses.approved) {
        return { type: 'not-preflightable', status: importRunResult.value.status };
    }

    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) return { type: 'bot-token-missing' };

    const currentResult = await readFluxerBotGuildStructure({
        botToken,
        guildId: context.guild.id,
    });

    if (currentResult.isErr()) return { type: 'structure-read-failed' };

    const currentSnapshot = toDashboardStructureSnapshot(currentResult.value);
    const policy = readStructurePolicy(importRunResult.value.plan);
    if (!policy) return { type: 'not-preflightable', status: 'invalid-v2-plan' };
    const projectionCheck = checkDashboardStructurePlanProjection(currentSnapshot, importRunResult.value.plan);
    const actionReport = preflightDashboardStructureImportPlan(
        currentSnapshot,
        importRunResult.value.actions.map(toPreflightAction),
        {
            idMap: readApplySourceTargetMap(importRunResult.value.plan),
            policy,
            sourceGuildId: readRequestedGuildId(importRunResult.value.plan),
        }
    );
    const report =
        projectionCheck.status === 'stale'
            ? prependDashboardStructureProjectionBlocker(actionReport, projectionCheck.message)
            : actionReport;
    const checkedAt = new Date();
    const liveFingerprint = structurePlanDigest(currentSnapshot);
    const preflightStatus = isDashboardStructurePreflightReady(report) ? 'ready' : 'blocked';
    const preflightDigest = structurePlanDigest({
        checkedAt: checkedAt.toISOString(),
        liveFingerprint,
        planDigest: importRunResult.value.planDigest,
        report,
        status: preflightStatus,
    });
    const persistedPreflight = await recordStructureImportPreflight(database.db, {
        runId: importRunId,
        planDigest: importRunResult.value.planDigest,
        liveFingerprint,
        preflightDigest,
        report: toJsonRecord(report),
        status: preflightStatus,
        checkedAt,
        expiresAt: new Date(checkedAt.getTime() + 5 * 60 * 1000),
        audit: createStructureAuditInput(context, structureAuditActions.importPreflightChecked, importRunId, {
            actionCount: report.summary.total,
            readyCount: report.summary.ready,
            staleCount: report.summary.stale,
            mappingRequiredCount: report.summary.mappingRequired,
            destructiveApprovalRequiredCount: report.summary.destructiveApprovalRequired,
            unsupportedCount: report.summary.unsupported,
            invalidPlanCount: report.summary.invalidPlan,
            planDigest: importRunResult.value.planDigest,
            preflightDigest,
        }),
    });

    if (persistedPreflight.isErr()) return { type: 'database-error' };

    return {
        type: 'preflight',
        importRunId,
        preflightDigest,
        checkedAt: checkedAt.toISOString(),
        expiresAt: new Date(checkedAt.getTime() + 5 * 60 * 1000).toISOString(),
        report,
    };
}

export function checkDashboardStructurePlanProjection(
    current: DashboardStructureSnapshot,
    persistedPlan: Record<string, unknown>
): { status: 'current' } | { status: 'stale'; message: string } {
    const requested = normalizeDashboardStructureSnapshot(persistedPlan.requestedSnapshot);
    const persistedDigest = typeof persistedPlan.planDigest === 'string' ? persistedPlan.planDigest : undefined;
    if (requested.type !== 'valid' || !persistedDigest || persistedPlan.planVersion !== 2) {
        return {
            status: 'stale',
            message: 'The reviewed blueprint projection is incomplete. Create a new plan before applying.',
        };
    }

    try {
        const policy = readStructurePolicy(persistedPlan);
        if (!policy) throw new Error('invalid-v2-plan');
        const recomputed = diffDashboardStructureSnapshot(current, requested.snapshot, {
            policy,
            roleMappings: readPersistedRoleMappings(persistedPlan),
            categoryMappings: readPersistedCategoryMappings(persistedPlan),
            channelMappings: readPersistedChannelMappings(persistedPlan),
        });

        if (structurePlanDigest(recomputed.fingerprintInput) === persistedDigest) {
            return { status: 'current' };
        }
    } catch {
        // Any newly invalid or ambiguous identity assignment invalidates the reviewed projection.
    }

    return {
        status: 'stale',
        message: 'The live server no longer matches the reviewed projection. Create a refreshed plan before applying.',
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

function readApplySourceTargetMap(plan: Record<string, unknown>): Record<string, string> {
    const directMap = isObject(plan.sourceTargetMap) ? plan.sourceTargetMap : undefined;
    const source = directMap ?? {};

    return Object.fromEntries(
        Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
