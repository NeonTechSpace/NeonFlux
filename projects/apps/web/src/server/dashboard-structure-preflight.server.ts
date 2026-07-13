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
    createDashboardStructureSnapshotFingerprintInput,
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

    const policy = readStructurePolicy(importRunResult.value.plan);
    const referenceAuthority = readStructureReferenceAuthority(importRunResult.value.plan);
    if (
        !policy ||
        !referenceAuthority ||
        !matchesReviewedStructureExecutionActions(importRunResult.value.plan, importRunResult.value.actions)
    ) {
        return { type: 'not-preflightable', status: 'invalid-v3-plan' };
    }

    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) return { type: 'bot-token-missing' };

    const currentResult = await readFluxerBotGuildStructure({
        botToken,
        guildId: context.guild.id,
    });

    if (currentResult.isErr()) return { type: 'structure-read-failed' };

    const currentSnapshot = toDashboardStructureSnapshot(currentResult.value);
    const projectionCheck = checkDashboardStructurePlanProjection(currentSnapshot, importRunResult.value.plan);
    const actionReport = preflightDashboardStructureImportPlan(
        currentSnapshot,
        importRunResult.value.actions.map(toPreflightAction),
        {
            idMap: referenceAuthority.idMap,
            knownTargetIds: Object.keys(referenceAuthority.knownTargetKinds),
            policy,
            sourceIds: referenceAuthority.sourceIds,
            ...(referenceAuthority.sourceGuildId ? { sourceGuildId: referenceAuthority.sourceGuildId } : {}),
        }
    );
    const report =
        projectionCheck.status === 'stale'
            ? prependDashboardStructureProjectionBlocker(actionReport, projectionCheck.message)
            : actionReport;
    const checkedAt = new Date();
    const liveFingerprint = structurePlanDigest(createDashboardStructureSnapshotFingerprintInput(currentSnapshot));
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
    const referenceAuthority = readStructureReferenceAuthority(persistedPlan);
    if (requested.type !== 'valid' || !persistedDigest || persistedPlan.planVersion !== 3 || !referenceAuthority) {
        return {
            status: 'stale',
            message: 'The reviewed blueprint projection is incomplete. Create a new plan before applying.',
        };
    }

    try {
        const policy = readStructurePolicy(persistedPlan);
        if (!policy) throw new Error('invalid-v3-plan');
        const recomputed = diffDashboardStructureSnapshot(current, requested.snapshot, {
            policy,
            roleMappings: readPersistedRoleMappings(persistedPlan),
            categoryMappings: readPersistedCategoryMappings(persistedPlan),
            channelMappings: readPersistedChannelMappings(persistedPlan),
        });
        const recomputedReferenceAuthority = readStructureReferenceAuthority({
            knownTargetKinds: recomputed.knownTargetKinds,
            requestedGuildId: requested.snapshot.guildId ?? null,
            sourceTargetMap: recomputed.sourceTargetMap,
        });

        if (
            recomputedReferenceAuthority &&
            sameStructureReferenceAuthority(referenceAuthority, recomputedReferenceAuthority) &&
            structurePlanDigest(recomputed.fingerprintInput) === persistedDigest
        ) {
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

export function matchesReviewedStructureExecutionActions(
    plan: Record<string, unknown>,
    actions: StructureImportActionRecord[]
): boolean {
    const executionActions = plan.executionActions;
    const fingerprintInput = isObject(plan.fingerprintInput) ? plan.fingerprintInput : undefined;
    const fingerprintActions = fingerprintInput?.executionActions;
    if (!Array.isArray(executionActions) || !Array.isArray(fingerprintActions)) return false;
    if (
        executionActions.length !== actions.length ||
        structurePlanDigest(executionActions) !== structurePlanDigest(fingerprintActions)
    ) {
        return false;
    }
    return executionActions.every((value, sequence) => {
        if (!isObject(value)) return false;
        const details = isObject(value.details) ? value.details : undefined;
        const action = actions[sequence];
        if (!details || action.sequence !== sequence || typeof value.label !== 'string') return false;
        return (
            structurePlanDigest({
                actionType: value.actionType,
                details,
                targetId: value.targetId,
                targetType: value.targetType,
            }) ===
            structurePlanDigest({
                actionType: action.actionType,
                details: toJsonRecord(action.details),
                targetId: action.targetId ?? undefined,
                targetType: action.targetType,
            })
        );
    });
}

function mapRepositoryError(error: { type: string }): DashboardStructureErrorResult {
    return error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
}

function toJsonRecord(value: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

type StructureReferenceAuthority = {
    idMap: Record<string, string>;
    knownTargetKinds: Record<string, 'role' | 'category' | 'channel'>;
    sourceGuildId?: string;
    sourceIds: string[];
    sourceTargetMap: Record<string, string | null>;
};

function readStructureReferenceAuthority(plan: Record<string, unknown>): StructureReferenceAuthority | undefined {
    const sourceTargetMap = plan.sourceTargetMap;
    const knownTargetKinds = plan.knownTargetKinds;
    if (!isObject(sourceTargetMap) || Array.isArray(sourceTargetMap) || !isObject(knownTargetKinds)) {
        return undefined;
    }

    const normalizedKnownTargetKinds: Record<string, 'role' | 'category' | 'channel'> = {};
    const knownTargetIdSet = new Set<string>();
    for (const [targetId, kind] of Object.entries(knownTargetKinds)) {
        if (
            !isCanonicalReferenceId(targetId) ||
            knownTargetIdSet.has(targetId) ||
            (kind !== 'role' && kind !== 'category' && kind !== 'channel')
        ) {
            return undefined;
        }
        knownTargetIdSet.add(targetId);
        normalizedKnownTargetKinds[targetId] = kind;
    }
    const targetIds = Object.keys(normalizedKnownTargetKinds);
    const sortedTargetIds = [...targetIds].sort((left, right) => left.localeCompare(right));
    if (!targetIds.every((targetId, index) => targetId === sortedTargetIds[index])) {
        return undefined;
    }

    const idMapEntries: Array<[string, string]> = [];
    const sourceIds: string[] = [];
    const sourceTargetEntries: Array<[string, string | null]> = [];
    const mappedTargetIds = new Set<string>();
    for (const [sourceId, targetId] of Object.entries(sourceTargetMap)) {
        if (!isCanonicalReferenceId(sourceId) || (targetId !== null && !isCanonicalReferenceId(targetId))) {
            return undefined;
        }
        sourceIds.push(sourceId);
        sourceTargetEntries.push([sourceId, targetId]);
        if (targetId === null) continue;
        if (!knownTargetIdSet.has(targetId) || mappedTargetIds.has(targetId)) return undefined;
        mappedTargetIds.add(targetId);
        idMapEntries.push([sourceId, targetId]);
    }

    const sourceGuildId = plan.requestedGuildId;
    if (sourceGuildId !== null && sourceGuildId !== undefined && !isCanonicalReferenceId(sourceGuildId)) {
        return undefined;
    }

    return {
        idMap: Object.fromEntries(idMapEntries),
        knownTargetKinds: normalizedKnownTargetKinds,
        ...(typeof sourceGuildId === 'string' ? { sourceGuildId } : {}),
        sourceIds: sourceIds.sort((left, right) => left.localeCompare(right)),
        sourceTargetMap: Object.fromEntries(sourceTargetEntries.sort(([left], [right]) => left.localeCompare(right))),
    };
}

function sameStructureReferenceAuthority(
    left: StructureReferenceAuthority,
    right: StructureReferenceAuthority
): boolean {
    return (
        structurePlanDigest({
            knownTargetKinds: left.knownTargetKinds,
            sourceGuildId: left.sourceGuildId ?? null,
            sourceTargetMap: left.sourceTargetMap,
        }) ===
        structurePlanDigest({
            knownTargetKinds: right.knownTargetKinds,
            sourceGuildId: right.sourceGuildId ?? null,
            sourceTargetMap: right.sourceTargetMap,
        })
    );
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isCanonicalReferenceId(value: unknown): value is string {
    return typeof value === 'string' && Boolean(value) && value === value.trim();
}
