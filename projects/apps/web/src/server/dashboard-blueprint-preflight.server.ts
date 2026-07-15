import '@tanstack/react-start/server-only';

import { blueprintAuditActions, blueprintPlanStatuses, recordBlueprintPlanPreflight } from '@neonflux/db';
import type { BlueprintPlanAuthorityRecord, BlueprintPlanMetadataRecord, BlueprintPlanStepRecord } from '@neonflux/db';
import {
    BLUEPRINT_MUTATION_FENCE_VERSION,
    BLUEPRINT_PREFLIGHT_EVIDENCE_VERSION,
    createBlueprintMutationFenceManifest,
    createBlueprintPlanIntegrityDigests,
    createBlueprintPreflightDigest,
    createBlueprintPreflightEvidenceDigests,
    deriveBlueprintPlanExecutionAuthorityBody,
} from '@neonflux/blueprint';

import { readDashboardBotGuildStructure } from './bot-read-client.server.js';
import { getWebDb } from './db.server.js';
import { createBlueprintAuditInput, loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import type { DashboardBlueprintErrorResult } from './dashboard-blueprint-model.js';
import { diffDashboardBlueprintSnapshot, toDashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import type { DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import { loadDashboardBlueprintPlanAuthorityDetail } from './dashboard-blueprint-plan-detail.server.js';
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
    if (!planId) return { type: 'invalid-input', message: 'Choose an approved deployment plan to check.' };

    const detail = await loadDashboardBlueprintPlanAuthorityDetail(context.guild.id, planId);
    if (detail.isErr()) return mapRepositoryError(detail.error);
    const { plan, authority, steps } = detail.value;
    if (plan.status !== blueprintPlanStatuses.approved) {
        return { type: 'not-preflightable', status: plan.status };
    }
    const currentResult = await readDashboardBotGuildStructure(context.guild.id);
    if (currentResult.isErr()) {
        return currentResult.error === 'not-configured'
            ? { type: 'bot-token-missing' }
            : { type: 'structure-read-failed' };
    }

    const currentSnapshot = toDashboardBlueprintSnapshot(currentResult.value);
    const projectionCheck = await checkDashboardBlueprintPlanProjection(currentSnapshot, plan, authority);
    const executionAuthority = deriveBlueprintPlanExecutionAuthorityBody(authority);
    const stepReport = evaluateDashboardBlueprintPlanPreflight(currentSnapshot, steps.map(toPreflightPlanStep), {
        idMap: executionAuthority.initialIdMap,
        knownTargetIds: Object.keys(executionAuthority.knownTargetKinds),
        policy: plan.policy,
        sourceIds: Object.keys(executionAuthority.sourceTargetMap),
        ...(executionAuthority.sourceGuildId ? { sourceGuildId: executionAuthority.sourceGuildId } : {}),
    });
    const report =
        projectionCheck.status === 'stale'
            ? prependDashboardBlueprintProjectionBlocker(stepReport, projectionCheck.message)
            : stepReport;
    const checkedAt = new Date();
    const expiresAt = new Date(checkedAt.getTime() + 5 * 60 * 1000);
    const mutationFenceManifest = await createBlueprintMutationFenceManifest(currentSnapshot);
    const status = isDashboardBlueprintPreflightReady(report) ? 'ready' : 'blocked';
    const evidenceDigests = await createBlueprintPreflightEvidenceDigests({ report, mutationFenceManifest });
    const preflightDigest = await createBlueprintPreflightDigest({
        planId,
        planDigest: plan.planDigest,
        status,
        checkedAt: checkedAt.toISOString(),
        observedAt: checkedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        fingerprintVersion: BLUEPRINT_MUTATION_FENCE_VERSION,
        structureFingerprint: mutationFenceManifest.structureDigest,
        capabilityFingerprint: mutationFenceManifest.capabilityDigest,
        evidenceDigest: evidenceDigests.evidenceDigest,
    });
    const database = await getWebDb();
    const persisted = await recordBlueprintPlanPreflight(database.db, {
        metadata: {
            planId,
            guildId: context.guild.id,
            status,
            summary: report.summary,
            checkedAt,
            observedAt: checkedAt,
            expiresAt,
            observationSource: 'resident-client',
            planDigest: plan.planDigest,
            fingerprintVersion: BLUEPRINT_MUTATION_FENCE_VERSION,
            structureFingerprint: mutationFenceManifest.structureDigest,
            capabilityFingerprint: mutationFenceManifest.capabilityDigest,
            evidenceVersion: BLUEPRINT_PREFLIGHT_EVIDENCE_VERSION,
            evidenceDigest: evidenceDigests.evidenceDigest,
            preflightDigest,
        },
        evidence: {
            version: BLUEPRINT_PREFLIGHT_EVIDENCE_VERSION,
            report,
            mutationFenceManifest,
            ...evidenceDigests,
        },
        sealedPlan: {
            authority,
            decisions: detail.value.decisions.map(({ decision, sequence }) => ({ decision, sequence })),
            steps: steps.map(({ sequence, step }) => ({ sequence, step })),
        },
        audit: createBlueprintAuditInput(context, blueprintAuditActions.preflightChecked, planId, {
            changeCount: report.summary.total,
            readyCount: report.summary.ready,
            staleCount: report.summary.stale,
            mappingRequiredCount: report.summary.mappingRequired,
            destructiveApprovalRequiredCount: report.summary.destructiveApprovalRequired,
            unsupportedCount: report.summary.unsupported,
            invalidPlanCount: report.summary.invalidPlan,
            planDigest: plan.planDigest,
            preflightDigest,
        }),
    });
    if (persisted.isErr()) return { type: 'database-error' };

    return {
        type: 'preflight',
        planId,
        preflightDigest,
        checkedAt: checkedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        report,
    };
}

export async function checkDashboardBlueprintPlanProjection(
    current: DashboardBlueprintSnapshot,
    plan: BlueprintPlanMetadataRecord,
    authority: BlueprintPlanAuthorityRecord
): Promise<{ status: 'current' } | { status: 'stale'; message: string }> {
    try {
        const recomputed = diffDashboardBlueprintSnapshot(current, authority.requestedSnapshot, {
            policy: plan.policy,
            roleMappings: authority.mappings.roles,
            categoryMappings: authority.mappings.categories,
            channelMappings: authority.mappings.channels,
        });
        const recomputedAuthority = {
            requestedSnapshot: authority.requestedSnapshot,
            projectedSnapshot: recomputed.projectedSnapshot,
            roleProjection: recomputed.roleProjection,
            mappings: recomputed.mappings,
            referenceAuthority: {
                sourceTargetMap: recomputed.sourceTargetMap,
                knownTargetKinds: recomputed.knownTargetKinds,
            },
            blockers: recomputed.blockers,
            provenance: authority.provenance,
        };
        const executionAuthority = deriveBlueprintPlanExecutionAuthorityBody(recomputedAuthority);
        const integrity = await createBlueprintPlanIntegrityDigests({
            guildId: plan.guildId,
            policy: plan.policy,
            summary: recomputed.summary,
            authority: recomputedAuthority,
            executionAuthority,
            steps: recomputed.steps.map((step, sequence) => ({ sequence, step })),
            decisions: recomputed.decisions.map((decision, sequence) => ({ sequence, decision })),
        });
        if (integrity.planDigest === plan.planDigest) return { status: 'current' };
    } catch {
        // Any invalid or ambiguous identity assignment invalidates the reviewed projection.
    }
    return {
        status: 'stale',
        message: 'The live server no longer matches the reviewed projection. Create a refreshed plan before applying.',
    };
}

function toPreflightPlanStep(record: BlueprintPlanStepRecord): DashboardBlueprintPreflightInputPlanStep {
    return {
        id: record.id,
        actionType: record.step.actionType,
        targetType: record.step.targetType,
        targetId: record.step.targetId,
        label: record.step.label,
        details: JSON.parse(JSON.stringify(record.step.details)) as Record<string, unknown>,
    };
}

function mapRepositoryError(error: { type: string }): DashboardBlueprintErrorResult {
    return error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
}
