import '@tanstack/react-start/server-only';

import {
    findBlueprintPlanWithStepsByGuildId,
    recordBlueprintPlanPreflight,
    blueprintAuditActions,
    blueprintPlanStatuses,
} from '@neonflux/db';
import type { BlueprintPlanStepRecord } from '@neonflux/db';

import { readDashboardBotGuildStructure } from './bot-read-client.server.js';
import { getWebDb } from './db.server.js';
import { createBlueprintAuditInput, loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import type { DashboardBlueprintErrorResult } from './dashboard-blueprint-model.js';
import {
    createDashboardBlueprintSnapshotFingerprintInput,
    diffDashboardBlueprintSnapshot,
    normalizeDashboardBlueprintSnapshot,
    toDashboardBlueprintSnapshot,
} from './dashboard-blueprint-diff.js';
import type { DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import {
    readPersistedCategoryMappings,
    readPersistedChannelMappings,
    readPersistedRoleMappings,
    readBlueprintPolicy,
    blueprintPlanDigest,
} from './dashboard-blueprint-apply-plan.js';
import {
    preflightDashboardBlueprintPlan as evaluateDashboardBlueprintPlanPreflight,
    isDashboardBlueprintPreflightReady,
    prependDashboardBlueprintProjectionBlocker,
} from './dashboard-blueprint-preflight.js';
import type {
    DashboardBlueprintPreflightInputPlanStep,
    DashboardBlueprintPreflightReport,
} from './dashboard-blueprint-preflight.js';

export type DashboardBlueprintPreflightInput = {
    guildId: string;
    planId: string;
};

export type DashboardBlueprintPreflightResult =
    | {
          type: 'preflight';
          planId: string;
          preflightDigest?: string;
          checkedAt?: string;
          expiresAt?: string;
          report: DashboardBlueprintPreflightReport;
      }
    | { type: 'invalid-input'; message: string }
    | { type: 'not-preflightable'; status: string }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardBlueprintErrorResult;

export async function preflightDashboardBlueprintPlan(
    request: Request,
    input: DashboardBlueprintPreflightInput
): Promise<DashboardBlueprintPreflightResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);

    if (context.type !== 'authorized') return context;

    const planId = input.planId.trim();

    if (!planId) {
        return { type: 'invalid-input', message: 'Choose an approved deployment plan to check.' };
    }

    const database = await getWebDb();
    const planResult = await findBlueprintPlanWithStepsByGuildId(database.db, {
        guildId: context.guild.id,
        planId: planId,
    });

    if (planResult.isErr()) return mapRepositoryError(planResult.error);

    if (planResult.value.status !== blueprintPlanStatuses.approved) {
        return { type: 'not-preflightable', status: planResult.value.status };
    }

    const policy = readBlueprintPolicy(planResult.value.plan);
    const referenceAuthority = readStructureReferenceAuthority(planResult.value.plan);
    if (!policy || !referenceAuthority || !matchesReviewedPlanSteps(planResult.value.plan, planResult.value.steps)) {
        return { type: 'not-preflightable', status: 'invalid-v3-plan' };
    }

    const currentResult = await readDashboardBotGuildStructure(context.guild.id);

    if (currentResult.isErr()) {
        return currentResult.error === 'not-configured'
            ? { type: 'bot-token-missing' }
            : { type: 'structure-read-failed' };
    }

    const currentSnapshot = toDashboardBlueprintSnapshot(currentResult.value);
    const projectionCheck = checkDashboardBlueprintPlanProjection(currentSnapshot, planResult.value.plan);
    const stepReport = evaluateDashboardBlueprintPlanPreflight(
        currentSnapshot,
        planResult.value.steps.map(toPreflightPlanStep),
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
            ? prependDashboardBlueprintProjectionBlocker(stepReport, projectionCheck.message)
            : stepReport;
    const checkedAt = new Date();
    const liveFingerprint = blueprintPlanDigest(createDashboardBlueprintSnapshotFingerprintInput(currentSnapshot));
    const preflightStatus = isDashboardBlueprintPreflightReady(report) ? 'ready' : 'blocked';
    const preflightDigest = blueprintPlanDigest({
        checkedAt: checkedAt.toISOString(),
        liveFingerprint,
        planDigest: planResult.value.planDigest,
        report,
        status: preflightStatus,
    });
    const persistedPreflight = await recordBlueprintPlanPreflight(database.db, {
        planId: planId,
        planDigest: planResult.value.planDigest,
        liveFingerprint,
        preflightDigest,
        report: toJsonRecord(report),
        status: preflightStatus,
        checkedAt,
        expiresAt: new Date(checkedAt.getTime() + 5 * 60 * 1000),
        audit: createBlueprintAuditInput(context, blueprintAuditActions.preflightChecked, planId, {
            changeCount: report.summary.total,
            readyCount: report.summary.ready,
            staleCount: report.summary.stale,
            mappingRequiredCount: report.summary.mappingRequired,
            destructiveApprovalRequiredCount: report.summary.destructiveApprovalRequired,
            unsupportedCount: report.summary.unsupported,
            invalidPlanCount: report.summary.invalidPlan,
            planDigest: planResult.value.planDigest,
            preflightDigest,
        }),
    });

    if (persistedPreflight.isErr()) return { type: 'database-error' };

    return {
        type: 'preflight',
        planId,
        preflightDigest,
        checkedAt: checkedAt.toISOString(),
        expiresAt: new Date(checkedAt.getTime() + 5 * 60 * 1000).toISOString(),
        report,
    };
}

export function checkDashboardBlueprintPlanProjection(
    current: DashboardBlueprintSnapshot,
    persistedPlan: Record<string, unknown>
): { status: 'current' } | { status: 'stale'; message: string } {
    const requested = normalizeDashboardBlueprintSnapshot(persistedPlan.requestedSnapshot);
    const persistedDigest = typeof persistedPlan.planDigest === 'string' ? persistedPlan.planDigest : undefined;
    const referenceAuthority = readStructureReferenceAuthority(persistedPlan);
    if (requested.type !== 'valid' || !persistedDigest || persistedPlan.planVersion !== 3 || !referenceAuthority) {
        return {
            status: 'stale',
            message: 'The reviewed blueprint projection is incomplete. Create a new plan before applying.',
        };
    }

    try {
        const policy = readBlueprintPolicy(persistedPlan);
        if (!policy) throw new Error('invalid-v3-plan');
        const recomputed = diffDashboardBlueprintSnapshot(current, requested.snapshot, {
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
            blueprintPlanDigest(recomputed.fingerprintInput) === persistedDigest
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

function toPreflightPlanStep(action: BlueprintPlanStepRecord): DashboardBlueprintPreflightInputPlanStep {
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

function matchesReviewedPlanSteps(plan: Record<string, unknown>, steps: BlueprintPlanStepRecord[]): boolean {
    const persistedSteps = plan.steps;
    const fingerprintInput = isObject(plan.fingerprintInput) ? plan.fingerprintInput : undefined;
    const fingerprintSteps = fingerprintInput?.steps;
    if (!Array.isArray(persistedSteps) || !Array.isArray(fingerprintSteps)) return false;
    if (
        persistedSteps.length !== steps.length ||
        blueprintPlanDigest(persistedSteps) !== blueprintPlanDigest(fingerprintSteps)
    ) {
        return false;
    }
    return persistedSteps.every((value, sequence) => {
        if (!isObject(value)) return false;
        const details = isObject(value.details) ? value.details : undefined;
        const step = steps[sequence];
        if (
            !details ||
            step.sequence !== sequence ||
            typeof value.label !== 'string' ||
            typeof value.actionType !== 'string' ||
            typeof value.targetType !== 'string' ||
            (value.targetId !== undefined && typeof value.targetId !== 'string')
        ) {
            return false;
        }
        return (
            blueprintPlanDigest({
                actionType: value.actionType,
                details,
                ...('targetId' in value ? { targetId: value.targetId } : {}),
                targetType: value.targetType,
            }) ===
            blueprintPlanDigest({
                actionType: step.actionType,
                details: toJsonRecord(step.details),
                ...(step.targetId ? { targetId: step.targetId } : {}),
                targetType: step.targetType,
            })
        );
    });
}

function mapRepositoryError(error: { type: string }): DashboardBlueprintErrorResult {
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
        blueprintPlanDigest({
            knownTargetKinds: left.knownTargetKinds,
            sourceGuildId: left.sourceGuildId ?? null,
            sourceTargetMap: left.sourceTargetMap,
        }) ===
        blueprintPlanDigest({
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
