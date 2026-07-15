import { canonicalJsonStringify } from '@neonflux/blueprint/canonical-json';
import {
    createBlueprintPlanIntegrityDigests,
    deriveBlueprintPlanExecutionAuthorityBody,
    createBlueprintPreflightDigest,
    createBlueprintPreflightEvidenceDigests,
    validateBlueprintPreflightEvidenceIntegrity,
    validateBlueprintPlanMetadataIntegrity,
    validateBlueprintRunVerificationEvidenceIntegrity,
} from '@neonflux/blueprint/integrity';
import {
    BLUEPRINT_MUTATION_FENCE_VERSION,
    parseBlueprintMutationFenceManifest,
} from '@neonflux/blueprint/mutation-fence';
import {
    isBlueprintPreflightReportReady,
    normalizeBlueprintPreflightReport,
} from '@neonflux/blueprint/preflight-report';
import { normalizeBlueprintPlanDecision } from '@neonflux/blueprint/runtime-contracts';
import { normalizeBlueprintPlanAuthority } from '@neonflux/blueprint/persisted-authority';
import { getDocumentSize, v, type GenericId, type Value } from 'convex/values';

import type { Doc } from '../_generated/dataModel.js';
import { mutation, query, type MutationCtx } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { blueprintRunLiveAreas } from '../core/dashboard_live_model.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../runtime_contract_model.js';
import { auditInputValidator, recordBlueprintAuditInMutation } from './blueprint.js';
import {
    hotRunRecordValidator,
    planMetadataRecordValidator,
    preflightMetadataRecordValidator,
    toHotRunRecord,
    toPlanMetadataRecord,
    toPreflightMetadataRecord,
} from './blueprint_hot_records.js';
import { loadAndValidateBlueprintPlanAuthority } from './blueprint_plan_persistence.js';
import { assertCurrentBlueprintRunProtocol } from './blueprint_run_protocol.js';
import { isBlueprintRunRetryPreflightFresh } from './blueprint_model.js';
import { assertBlueprintRunMetadataBounded } from './blueprint_run_persistence.js';

const planStatuses = ['draft', 'needs_input', 'review_ready', 'approved', 'obsolete'] as const;
const planTransitions: Record<string, readonly string[]> = {
    draft: ['obsolete'],
    needs_input: ['draft', 'obsolete'],
    review_ready: ['obsolete'],
    approved: ['obsolete'],
};
const activeStatuses = ['queued', 'running', 'waiting_rate_limit', 'pause_requested', 'paused', 'verifying'] as const;
const preflightSummaryValidator = v.object({
    destructiveApprovalRequired: v.number(),
    invalidPlan: v.number(),
    mappingRequired: v.number(),
    ready: v.number(),
    stale: v.number(),
    total: v.number(),
    unsupported: v.number(),
});
const preflightEvidenceValidator = v.object({
    createdAt: v.string(),
    evidenceDigest: v.string(),
    id: v.string(),
    manifestDigest: v.string(),
    mutationFenceManifest: v.any(),
    planId: v.string(),
    preflightId: v.string(),
    report: v.any(),
    reportDigest: v.string(),
    version: v.literal(1),
});
const decisionRecordValidator = v.object({
    createdAt: v.string(),
    decision: v.any(),
    id: v.string(),
    planId: v.string(),
    sequence: v.number(),
});
const decisionPageValidator = v.object({
    decisions: v.array(decisionRecordValidator),
    nextCursor: v.union(v.number(), v.null()),
});
const MAX_PREFLIGHT_METADATA_BYTES = 16 * 1024;
const MAX_PREFLIGHT_EVIDENCE_BYTES = 700 * 1024;
const MAX_RUN_CURSOR_BYTES = 4 * 1024;

export const transitionBlueprintPlanState = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        expectedStatus: v.union(...planStatuses.map((status) => v.literal(status))),
        now: v.string(),
        planId: v.id('blueprintPlans'),
        status: v.union(...planStatuses.map((status) => v.literal(status))),
    },
    returns: planMetadataRecordValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (!plan) throw new Error('blueprint-plan-not-found');
        if (plan.status !== args.expectedStatus) throw new Error('blueprint-plan-state-conflict');
        if (!planTransitions[plan.status]?.includes(args.status)) throw new Error('blueprint-plan-transition-invalid');
        const now = requireTimestamp(args.now, 'blueprint-plan-transition-time-invalid');
        const patch = { status: args.status, updatedAt: now };
        await ctx.db.patch('blueprintPlans', plan._id, patch);
        await recordBlueprintAuditInMutation(ctx, plan.guildId, args.audit, now, String(plan._id));
        return toPlanMetadataRecord({ ...plan, ...patch });
    },
});

export const listBlueprintPlanDecisionsPage = query({
    args: { cursor: v.optional(v.number()), guildId: v.string(), limit: v.number(), planId: v.id('blueprintPlans') },
    returns: decisionPageValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (plan?.guildId !== args.guildId) return { decisions: [], nextCursor: null };
        const limit = Math.min(Math.max(Math.trunc(args.limit), 1), 100);
        const decisions = await ctx.db
            .query('blueprintPlanDecisions')
            .withIndex('by_plan_sequence', (q) =>
                args.cursor === undefined
                    ? q.eq('planId', args.planId)
                    : q.eq('planId', args.planId).gt('sequence', args.cursor)
            )
            .order('asc')
            .take(limit + 1);
        const page = decisions.slice(0, limit);
        return {
            decisions: page.map(toDecisionRecord),
            nextCursor: decisions.length > page.length ? (page.at(-1)?.sequence ?? null) : null,
        };
    },
});

export const getBlueprintPlanPreflightEvidence = query({
    args: { guildId: v.string(), preflightId: v.id('blueprintPlanPreflights') },
    returns: v.union(preflightEvidenceValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const preflight = await ctx.db.get('blueprintPlanPreflights', args.preflightId);
        if (preflight?.guildId !== args.guildId) return null;
        const evidence = await ctx.db
            .query('blueprintPlanPreflightEvidence')
            .withIndex('by_preflight', (q) => q.eq('preflightId', args.preflightId))
            .unique();
        if (!evidence) return null;
        const integrity = await validateBlueprintPreflightEvidenceIntegrity(stripConvexMetadata(evidence));
        if (
            integrity.type === 'invalid' ||
            integrity.value.preflightId !== String(preflight._id) ||
            integrity.value.planId !== String(preflight.planId) ||
            integrity.value.evidenceDigest !== preflight.evidenceDigest
        ) {
            throw new Error('blueprint-plan-preflight-evidence-invalid');
        }
        return { id: String(evidence._id), ...integrity.value };
    },
});

export const getBlueprintRunVerificationEvidence = query({
    args: { guildId: v.string(), runId: v.id('blueprintRuns') },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const run = await ctx.db.get('blueprintRuns', args.runId);
        if (run?.guildId !== args.guildId) return null;
        const evidence = await ctx.db
            .query('blueprintRunVerificationEvidence')
            .withIndex('by_run', (q) => q.eq('runId', args.runId))
            .unique();
        if (!evidence) return null;
        const integrity = await validateBlueprintRunVerificationEvidenceIntegrity(stripConvexMetadata(evidence));
        if (
            integrity.type === 'invalid' ||
            integrity.value.runId !== String(run._id) ||
            integrity.value.planId !== String(run.planId) ||
            integrity.value.verificationEvidenceDigest !== run.verificationEvidenceDigest ||
            integrity.value.verificationStatus !== run.verificationStatus ||
            run.verificationEvidenceVersion !== 1
        ) {
            throw new Error('blueprint-run-verification-evidence-invalid');
        }
        return { ...integrity.value, id: String(evidence._id) };
    },
});

export const findLatestBlueprintPlanApproval = query({
    args: { guildId: v.string(), planId: v.id('blueprintPlans') },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (plan?.guildId !== args.guildId) return null;
        return ctx.db
            .query('blueprintPlanApprovals')
            .withIndex('by_plan_approved', (q) => q.eq('planId', args.planId))
            .order('desc')
            .first();
    },
});

export const findActiveBlueprintRun = query({
    args: { guildId: v.string() },
    returns: v.union(hotRunRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const candidates = await Promise.all(
            activeStatuses.map((status) =>
                ctx.db
                    .query('blueprintRuns')
                    .withIndex('by_guild_status', (q) => q.eq('guildId', args.guildId).eq('status', status))
                    .order('desc')
                    .first()
            )
        );
        const latest = candidates
            .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
        return latest ? toHotRunRecord(latest) : null;
    },
});

export const recordBlueprintPlanPreflight = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        evidence: v.object({
            evidenceDigest: v.string(),
            manifestDigest: v.string(),
            mutationFenceManifest: v.any(),
            report: v.any(),
            reportDigest: v.string(),
            version: v.literal(1),
        }),
        metadata: v.object({
            capabilityFingerprint: v.string(),
            checkedAt: v.string(),
            evidenceDigest: v.string(),
            evidenceVersion: v.literal(1),
            expiresAt: v.string(),
            fingerprintVersion: v.literal(BLUEPRINT_MUTATION_FENCE_VERSION),
            guildId: v.string(),
            observationSource: v.literal('resident-client'),
            observedAt: v.string(),
            planDigest: v.string(),
            planId: v.id('blueprintPlans'),
            preflightDigest: v.string(),
            status: v.union(v.literal('ready'), v.literal('blocked'), v.literal('stale')),
            structureFingerprint: v.string(),
            summary: preflightSummaryValidator,
        }),
        sealedPlan: v.object({
            authority: v.any(),
            decisions: v.array(v.object({ decision: v.any(), sequence: v.number() })),
            steps: v.array(v.object({ sequence: v.number(), step: v.any() })),
        }),
    },
    returns: preflightMetadataRecordValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const plan = await ctx.db.get('blueprintPlans', args.metadata.planId);
        if (plan?.guildId !== args.metadata.guildId || plan.planDigest !== args.metadata.planDigest) {
            throw new Error('blueprint-plan-preflight-stale');
        }
        if (plan.status !== 'approved') throw new Error('blueprint-plan-preflight-state-invalid');
        const sealedAuthority = normalizeBlueprintPlanAuthority(args.sealedPlan.authority);
        if (sealedAuthority.type === 'invalid') throw new Error('blueprint-plan-preflight-stale');
        const sealedIntegrity = await createBlueprintPlanIntegrityDigests({
            guildId: plan.guildId,
            policy: plan.policy,
            summary: plan.summary,
            authority: sealedAuthority.value,
            executionAuthority: deriveBlueprintPlanExecutionAuthorityBody(sealedAuthority.value),
            steps: args.sealedPlan.steps,
            decisions: args.sealedPlan.decisions,
        });
        if (validateBlueprintPlanMetadataIntegrity(plan, sealedIntegrity).type === 'invalid') {
            throw new Error('blueprint-plan-preflight-stale');
        }
        const checkedAt = requireTimestamp(args.metadata.checkedAt, 'blueprint-plan-preflight-time-invalid');
        const observedAt = requireTimestamp(args.metadata.observedAt, 'blueprint-plan-preflight-time-invalid');
        const expiresAt = requireTimestamp(args.metadata.expiresAt, 'blueprint-plan-preflight-time-invalid');
        if (expiresAt <= checkedAt) throw new Error('blueprint-plan-preflight-state-invalid');
        const report = normalizeBlueprintPreflightReport(args.evidence.report);
        if (report.type === 'invalid') throw new Error('blueprint-plan-preflight-report-invalid');
        if (canonicalJsonStringify(report.value.summary) !== canonicalJsonStringify(args.metadata.summary)) {
            throw new Error('blueprint-plan-preflight-summary-mismatch');
        }
        if ((args.metadata.status === 'ready') !== isBlueprintPreflightReportReady(report.value)) {
            throw new Error('blueprint-plan-preflight-state-invalid');
        }
        const manifest = parseBlueprintMutationFenceManifest(args.evidence.mutationFenceManifest);
        if (
            manifest.guildId !== plan.guildId ||
            manifest.structureDigest !== args.metadata.structureFingerprint ||
            manifest.capabilityDigest !== args.metadata.capabilityFingerprint
        ) {
            throw new Error('blueprint-plan-preflight-fingerprint-invalid');
        }
        const evidenceDigests = await createBlueprintPreflightEvidenceDigests({
            report: report.value,
            mutationFenceManifest: manifest,
        });
        if (
            evidenceDigests.reportDigest !== args.evidence.reportDigest ||
            evidenceDigests.manifestDigest !== args.evidence.manifestDigest ||
            evidenceDigests.evidenceDigest !== args.evidence.evidenceDigest ||
            args.evidence.evidenceDigest !== args.metadata.evidenceDigest
        ) {
            throw new Error('blueprint-plan-preflight-evidence-digest-mismatch');
        }
        const expectedPreflightDigest = await createBlueprintPreflightDigest({
            planId: String(plan._id),
            planDigest: plan.planDigest,
            status: args.metadata.status,
            checkedAt,
            observedAt,
            expiresAt,
            fingerprintVersion: args.metadata.fingerprintVersion,
            structureFingerprint: args.metadata.structureFingerprint,
            capabilityFingerprint: args.metadata.capabilityFingerprint,
            evidenceDigest: evidenceDigests.evidenceDigest,
        });
        if (expectedPreflightDigest !== args.metadata.preflightDigest) {
            throw new Error('blueprint-plan-preflight-digest-mismatch');
        }
        const metadataDocument = {
            ...args.metadata,
            checkedAt,
            observedAt,
            expiresAt,
        };
        assertDocumentSize(
            metadataDocument,
            MAX_PREFLIGHT_METADATA_BYTES,
            'blueprint-plan-preflight-metadata-too-large'
        );
        const preflightId = await ctx.db.insert('blueprintPlanPreflights', metadataDocument);
        const evidenceDocument = {
            ...args.evidence,
            createdAt: checkedAt,
            mutationFenceManifest: manifest,
            planId: plan._id,
            preflightId,
            report: report.value,
        };
        assertDocumentSize(
            evidenceDocument,
            MAX_PREFLIGHT_EVIDENCE_BYTES,
            'blueprint-plan-preflight-evidence-too-large'
        );
        const integrity = await validateBlueprintPreflightEvidenceIntegrity(evidenceDocument);
        if (integrity.type === 'invalid') throw new Error('blueprint-plan-preflight-evidence-invalid');
        await ctx.db.insert('blueprintPlanPreflightEvidence', evidenceDocument);
        await recordBlueprintAuditInMutation(
            ctx,
            plan.guildId,
            args.audit ?? { action: 'blueprint.plan_preflight_checked' },
            checkedAt,
            String(plan._id)
        );
        return toPreflightMetadataRecord({ ...metadataDocument, _id: preflightId });
    },
});

export const approveBlueprintPlan = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        approvedAt: v.string(),
        approvedByUserId: v.optional(v.string()),
        confirmationMethod: v.optional(v.union(v.literal('acknowledgement'), v.literal('target_name'))),
        deleteSetDigest: v.optional(v.string()),
        destructiveStepCount: v.optional(v.number()),
        destructiveApprovedAt: v.optional(v.string()),
        destructivePreflightDigest: v.optional(v.string()),
        planDigest: v.string(),
        planId: v.id('blueprintPlans'),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (plan?.planDigest !== args.planDigest) throw new Error('blueprint-plan-approval-stale');
        if (
            plan.blockerCount > 0 ||
            plan.decisionSummary.blockedAmbiguous > 0 ||
            plan.decisionSummary.blockedUnsupported > 0
        ) {
            throw new Error('blueprint-plan-approval-blocked');
        }
        const approvedAt = requireTimestamp(args.approvedAt, 'blueprint-plan-approval-time-invalid');
        const isDeploymentApproval = Boolean(args.destructivePreflightDigest);
        const isDestructiveApproval = isDeploymentApproval && plan.deleteStepCount > 0;
        if (
            !isDeploymentApproval &&
            (args.deleteSetDigest ||
                args.destructiveStepCount !== undefined ||
                args.destructiveApprovedAt ||
                args.confirmationMethod)
        ) {
            throw new Error('blueprint-plan-approval-destructive-fields-invalid');
        }
        if (
            (!isDeploymentApproval && plan.status !== 'review_ready') ||
            (isDeploymentApproval && plan.status !== 'approved')
        ) {
            throw new Error('blueprint-plan-approval-state-conflict');
        }
        const preflight = isDeploymentApproval ? await latestPreflight(ctx, args.planId) : null;
        if (isDeploymentApproval) {
            if (!args.confirmationMethod) throw new Error('blueprint-plan-approval-state-conflict');
            if (isDestructiveApproval) {
                if (
                    !args.destructiveApprovedAt ||
                    plan.deleteSetDigest !== args.deleteSetDigest ||
                    plan.deleteStepCount !== args.destructiveStepCount ||
                    plan.policy === 'merge' ||
                    args.confirmationMethod !== (plan.policy === 'rebuild' ? 'target_name' : 'acknowledgement')
                ) {
                    throw new Error('blueprint-plan-approval-delete-set-stale');
                }
            } else if (
                args.deleteSetDigest ||
                args.destructiveStepCount !== undefined ||
                args.destructiveApprovedAt ||
                args.confirmationMethod !== 'acknowledgement'
            ) {
                throw new Error('blueprint-plan-approval-destructive-fields-invalid');
            }
            if (
                !preflight ||
                preflight.preflightDigest !== args.destructivePreflightDigest ||
                preflight.status !== 'ready' ||
                preflight.expiresAt <= approvedAt
            ) {
                throw new Error('blueprint-plan-approval-preflight-stale');
            }
        }
        const approvalDocument = {
            approvedAt,
            ...(args.approvedByUserId ? { approvedByUserId: args.approvedByUserId } : {}),
            ...(args.confirmationMethod ? { confirmationMethod: args.confirmationMethod } : {}),
            ...(args.deleteSetDigest ? { deleteSetDigest: args.deleteSetDigest } : {}),
            ...(args.destructiveApprovedAt ? { destructiveApprovedAt: args.destructiveApprovedAt } : {}),
            ...(args.destructivePreflightDigest ? { destructivePreflightDigest: args.destructivePreflightDigest } : {}),
            ...(args.destructiveStepCount === undefined ? {} : { destructiveStepCount: args.destructiveStepCount }),
            planDigest: plan.planDigest,
            planId: plan._id,
            ...(preflight
                ? {
                      approvedCapabilityFingerprint: preflight.capabilityFingerprint,
                      approvedStructureFingerprint: preflight.structureFingerprint,
                      fingerprintVersion: preflight.fingerprintVersion,
                  }
                : {}),
        };
        const id = await ctx.db.insert('blueprintPlanApprovals', approvalDocument);
        if (!isDeploymentApproval)
            await ctx.db.patch('blueprintPlans', plan._id, { status: 'approved', updatedAt: approvedAt });
        await recordBlueprintAuditInMutation(
            ctx,
            plan.guildId,
            args.audit ?? { action: 'blueprint.plan_approved' },
            approvedAt,
            String(plan._id)
        );
        return { id, ...approvalDocument };
    },
});

export const enqueueBlueprintRun = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        now: v.string(),
        preflightDigest: v.string(),
        protocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
        planId: v.id('blueprintPlans'),
    },
    returns: hotRunRecordValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const now = requireTimestamp(args.now, 'blueprint-run-time-invalid');
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (!plan) throw new Error('blueprint-plan-not-found');
        if (plan.status !== 'approved') throw new Error('blueprint-run-plan-not-approved');
        const validated = await loadAndValidateBlueprintPlanAuthority(ctx, plan);
        const preflight = await latestPreflight(ctx, args.planId);
        const approval = await ctx.db
            .query('blueprintPlanApprovals')
            .withIndex('by_plan_approved', (q) => q.eq('planId', args.planId))
            .order('desc')
            .first();
        const latestRun = await ctx.db
            .query('blueprintRuns')
            .withIndex('by_plan_created', (q) => q.eq('planId', args.planId))
            .order('desc')
            .first();
        if (!preflight) throw new Error('blueprint-run-review-stale');
        const evidence = await ctx.db
            .query('blueprintPlanPreflightEvidence')
            .withIndex('by_preflight', (q) => q.eq('preflightId', preflight._id))
            .unique();
        if (!evidence) throw new Error('blueprint-run-review-stale');
        const evidenceIntegrity = await validateBlueprintPreflightEvidenceIntegrity(stripConvexMetadata(evidence));
        const expectedPreflightDigest = await createBlueprintPreflightDigest({
            planId: String(plan._id),
            planDigest: plan.planDigest,
            status: preflight.status,
            checkedAt: preflight.checkedAt,
            observedAt: preflight.observedAt,
            expiresAt: preflight.expiresAt,
            fingerprintVersion: preflight.fingerprintVersion,
            structureFingerprint: preflight.structureFingerprint,
            capabilityFingerprint: preflight.capabilityFingerprint,
            evidenceDigest: preflight.evidenceDigest,
        });
        if (
            evidenceIntegrity.type === 'invalid' ||
            evidenceIntegrity.value.preflightId !== String(preflight._id) ||
            evidenceIntegrity.value.planId !== String(plan._id) ||
            evidenceIntegrity.value.evidenceDigest !== preflight.evidenceDigest ||
            expectedPreflightDigest !== preflight.preflightDigest ||
            !approval ||
            preflight.status !== 'ready' ||
            preflight.planDigest !== plan.planDigest ||
            preflight.preflightDigest !== args.preflightDigest ||
            preflight.expiresAt <= now ||
            !isBlueprintRunRetryPreflightFresh({ latestRun, preflightCheckedAt: preflight.checkedAt }) ||
            approval.planDigest !== plan.planDigest ||
            approval.destructivePreflightDigest !== preflight.preflightDigest ||
            approval.fingerprintVersion !== preflight.fingerprintVersion ||
            approval.approvedStructureFingerprint !== preflight.structureFingerprint ||
            approval.approvedCapabilityFingerprint !== preflight.capabilityFingerprint ||
            !approval.confirmationMethod ||
            (plan.deleteStepCount > 0 &&
                (approval.deleteSetDigest !== plan.deleteSetDigest ||
                    approval.destructiveStepCount !== plan.deleteStepCount ||
                    !approval.destructiveApprovedAt))
        ) {
            throw new Error('blueprint-run-review-stale');
        }
        const activeRun = await findActiveGuildRun(ctx, plan.guildId);
        if (activeRun) {
            assertCurrentBlueprintRunProtocol(activeRun);
            throw new Error('blueprint-guild-run-active');
        }
        const totalSteps = validated.steps.length;
        if (totalSteps === 0) throw new Error('blueprint-run-empty');
        const runDocument = {
            appliedSteps: 0,
            completedMutationSteps: 0,
            createdAt: now,
            failedSteps: 0,
            fingerprintVersion: preflight.fingerprintVersion,
            guildId: plan.guildId,
            nextStepSequence: 0,
            notStartedSteps: totalSteps,
            phase: 'queued' as const,
            preflightId: preflight._id,
            preflightDigest: preflight.preflightDigest,
            preflightExpiresAt: preflight.expiresAt,
            expectedCapabilityFingerprint: preflight.capabilityFingerprint,
            expectedStructureFingerprint: preflight.structureFingerprint,
            executionAuthorityDigest: plan.executionAuthorityDigest,
            protocolVersion: args.protocolVersion,
            planId: args.planId,
            status: 'queued' as const,
            skippedSteps: 0,
            totalSteps,
            totalMutationSteps: totalSteps,
            updatedAt: now,
        };
        assertBlueprintRunMetadataBounded(runDocument);
        const runId = await ctx.db.insert('blueprintRuns', runDocument);
        const cursorDocument = {
            version: 1 as const,
            runId,
            planId: plan._id,
            mappingCount: 0,
            updatedAt: now,
        };
        assertDocumentSize(cursorDocument, MAX_RUN_CURSOR_BYTES, 'blueprint-run-cursor-too-large');
        await ctx.db.insert('blueprintRunCursors', cursorDocument);
        await markDashboardLiveAreasChangedInMutation(ctx, {
            areas: blueprintRunLiveAreas,
            guildId: plan.guildId,
            now,
        });
        await recordBlueprintAuditInMutation(
            ctx,
            plan.guildId,
            args.audit ?? { action: 'blueprint.run_queued' },
            now,
            String(runId)
        );
        return toHotRunRecord({ ...runDocument, _id: runId });
    },
});

async function latestPreflight(ctx: MutationCtx, planId: GenericId<'blueprintPlans'>) {
    return ctx.db
        .query('blueprintPlanPreflights')
        .withIndex('by_plan_checked', (q) => q.eq('planId', planId))
        .order('desc')
        .first();
}

async function findActiveGuildRun(ctx: MutationCtx, guildId: string) {
    for (const status of activeStatuses) {
        const run = await ctx.db
            .query('blueprintRuns')
            .withIndex('by_guild_status', (q) => q.eq('guildId', guildId).eq('status', status))
            .first();
        if (run) return run;
    }
    return null;
}

function toDecisionRecord(decision: Doc<'blueprintPlanDecisions'>) {
    const normalized = normalizeBlueprintPlanDecision(decision.decision);
    if (normalized.type === 'invalid') throw new Error('blueprint-plan-decision-invalid');
    return {
        createdAt: decision.createdAt,
        decision: normalized.value,
        id: String(decision._id),
        planId: String(decision.planId),
        sequence: decision.sequence,
    };
}

function assertDocumentSize(value: Record<string, Value>, maximum: number, errorType: string): void {
    if (getDocumentSize(value) > maximum) throw new Error(errorType);
}

function requireTimestamp(value: string, errorType: string): string {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error(errorType);
    const normalized = new Date(parsed).toISOString();
    if (normalized !== value) throw new Error(errorType);
    return normalized;
}

function stripConvexMetadata<T extends { _id: unknown; _creationTime: unknown }>(
    value: T
): Omit<T, '_id' | '_creationTime'> {
    const { _id: ignoredId, _creationTime: ignoredCreationTime, ...document } = value;
    void ignoredId;
    void ignoredCreationTime;
    return document;
}
