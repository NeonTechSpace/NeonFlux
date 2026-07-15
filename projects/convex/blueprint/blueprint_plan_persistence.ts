import { canonicalJsonStringify } from '@neonflux/blueprint/canonical-json';
import {
    createBlueprintPlanExecutionAuthorityPersistence,
    validateBlueprintPlanExecutionAuthorityPersistence,
} from '@neonflux/blueprint/execution-authority';
import {
    createBlueprintPlanAuthority,
    createBlueprintPlanDigest,
    createBlueprintPlanCreationRequestKey,
    createBlueprintPlanIntegrityDigests,
    deriveBlueprintPlanExecutionAuthorityBody,
    sha256CanonicalJson,
    validateBlueprintPlanAuthorityIntegrity,
    validateBlueprintPlanExecutionAuthorityIntegrity,
    validateBlueprintPlanMetadataIntegrity,
} from '@neonflux/blueprint/integrity';
import { blueprintPlanDecisionSummaryFields } from '@neonflux/blueprint/plan-summary';
import {
    normalizeBlueprintPlanAuthorityBody,
    normalizeBlueprintPlanExecutionAuthorityBody,
} from '@neonflux/blueprint/persisted-authority';
import { normalizeBlueprintPlanDecision, normalizeBlueprintPlanStep } from '@neonflux/blueprint/runtime-contracts';
import { getDocumentSize, v, type GenericId, type Value } from 'convex/values';

import type { Doc } from '../_generated/dataModel.js';
import { mutation, query, type MutationCtx } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { auditInputValidator, recordBlueprintAuditInMutation } from './blueprint.js';
import { planMetadataRecordValidator, toPlanMetadataRecord } from './blueprint_hot_records.js';

const planSummaryValidator = v.object({
    creates: v.number(),
    updates: v.number(),
    deletes: v.number(),
    roles: v.number(),
    categories: v.number(),
    channels: v.number(),
});

const decisionSummaryValidator = v.object({
    noOp: v.number(),
    create: v.number(),
    update: v.number(),
    delete: v.number(),
    protectedRetained: v.number(),
    protectedOmitted: v.number(),
    unmanagedRetained: v.number(),
    blockedAmbiguous: v.number(),
    blockedUnsupported: v.number(),
});

const metadataInputValidator = v.object({
    authorityDigest: v.string(),
    authorityVersion: v.literal(1),
    blockerCount: v.number(),
    createdByUserId: v.optional(v.union(v.string(), v.null())),
    decisionCount: v.number(),
    decisionLedgerDigest: v.string(),
    decisionSummary: decisionSummaryValidator,
    deleteSetDigest: v.optional(v.string()),
    deleteStepCount: v.number(),
    executionAuthorityDigest: v.string(),
    executionAuthorityVersion: v.literal(1),
    guildId: v.string(),
    planDigest: v.string(),
    planVersion: v.literal(4),
    policy: v.union(v.literal('merge'), v.literal('synchronize'), v.literal('rebuild')),
    projectedSnapshotDigest: v.string(),
    requestedSnapshotDigest: v.string(),
    sourceBackupId: v.optional(v.union(v.string(), v.null())),
    stepCount: v.number(),
    stepLedgerDigest: v.string(),
    summary: planSummaryValidator,
});

const stepEntryValidator = v.object({ sequence: v.number(), step: v.any() });
const decisionEntryValidator = v.object({ sequence: v.number(), decision: v.any() });
const planStepRecordValidator = v.object({
    createdAt: v.string(),
    id: v.string(),
    planId: v.string(),
    sequence: v.number(),
    step: v.any(),
});
const planDecisionRecordValidator = v.object({
    createdAt: v.string(),
    decision: v.any(),
    id: v.string(),
    planId: v.string(),
    sequence: v.number(),
});

const MAX_PLAN_METADATA_BYTES = 16 * 1024;
const MAX_PLAN_AUTHORITY_BYTES = 700 * 1024;
const MAX_PLAN_EXECUTION_AUTHORITY_MANIFEST_BYTES = 8 * 1024;
const MAX_PLAN_EXECUTION_AUTHORITY_BUCKET_BYTES = 8 * 1024;
const MAX_PLAN_LEDGER_BYTES = 8 * 1024 * 1024;
const MAX_PLAN_STEP_BYTES = 256 * 1024;

export const createBlueprintPlanDraft = mutation({
    args: {
        authority: v.any(),
        creationRequestKey: v.string(),
        executionAuthority: v.any(),
        metadata: metadataInputValidator,
        now: v.string(),
    },
    returns: planMetadataRecordValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const guildId = requireCanonicalText(args.metadata.guildId, 'blueprint-plan-guild-invalid');
        const creationRequestKey = requireCanonicalText(
            args.creationRequestKey,
            'blueprint-plan-creation-request-key-invalid'
        );
        if (creationRequestKey.length > 256) throw new Error('blueprint-plan-creation-request-key-invalid');
        const createdAt = requireTimestamp(args.now, 'blueprint-plan-created-at-invalid');
        assertPlanMetadataInput(args.metadata);
        await requireGuild(ctx, guildId);
        const sourceBackupId = await requireSourceBackup(ctx, guildId, args.metadata.sourceBackupId);

        if (!isRecord(args.authority) || !isRecord(args.executionAuthority)) {
            throw new Error('blueprint-plan-authority-invalid');
        }
        if (
            args.authority.version !== 1 ||
            args.authority.guildId !== guildId ||
            args.authority.authorityDigest !== args.metadata.authorityDigest
        ) {
            throw new Error('blueprint-plan-authority-metadata-mismatch');
        }
        if (
            args.executionAuthority.version !== 1 ||
            args.executionAuthority.guildId !== guildId ||
            args.executionAuthority.executionAuthorityDigest !== args.metadata.executionAuthorityDigest
        ) {
            throw new Error('blueprint-plan-execution-authority-metadata-mismatch');
        }
        const authorityBodyResult = normalizeBlueprintPlanAuthorityBody({
            requestedSnapshot: args.authority.requestedSnapshot,
            projectedSnapshot: args.authority.projectedSnapshot,
            roleProjection: args.authority.roleProjection,
            mappings: args.authority.mappings,
            referenceAuthority: args.authority.referenceAuthority,
            blockers: args.authority.blockers,
            provenance: args.authority.provenance,
        });
        if (authorityBodyResult.type === 'invalid') throw new Error('blueprint-plan-authority-invalid');
        const executionBodyResult = normalizeBlueprintPlanExecutionAuthorityBody({
            sourceGuildId: args.executionAuthority.sourceGuildId,
            sourceTargetMap: args.executionAuthority.sourceTargetMap,
            knownTargetKinds: args.executionAuthority.knownTargetKinds,
            initialIdMap: args.executionAuthority.initialIdMap,
        });
        if (executionBodyResult.type === 'invalid') throw new Error('blueprint-plan-execution-authority-invalid');
        const authorityBody = authorityBodyResult.value;
        const executionBody = executionBodyResult.value;
        if (args.metadata.blockerCount !== authorityBody.blockers.length) {
            throw new Error('blueprint-plan-blocker-count-mismatch');
        }
        if (
            canonicalJsonStringify(deriveBlueprintPlanExecutionAuthorityBody(authorityBody)) !==
            canonicalJsonStringify(executionBody)
        ) {
            throw new Error('blueprint-plan-execution-authority-derivation-mismatch');
        }
        const expectedCreationRequestKey = await createBlueprintPlanCreationRequestKey({
            authority: authorityBody,
            blockerCount: args.metadata.blockerCount,
            ...(args.metadata.createdByUserId ? { createdByUserId: args.metadata.createdByUserId } : {}),
            decisionLedger: { count: args.metadata.decisionCount, digest: args.metadata.decisionLedgerDigest },
            decisionSummary: args.metadata.decisionSummary,
            deleteLedger: {
                count: args.metadata.deleteStepCount,
                digest: args.metadata.deleteSetDigest ?? null,
            },
            executionAuthorityDigest: args.metadata.executionAuthorityDigest,
            guildId,
            policy: args.metadata.policy,
            ...(sourceBackupId ? { sourceBackupId: String(sourceBackupId) } : {}),
            stepLedger: { count: args.metadata.stepCount, digest: args.metadata.stepLedgerDigest },
            summary: args.metadata.summary,
        });
        if (creationRequestKey !== expectedCreationRequestKey) {
            throw new Error('blueprint-plan-creation-request-key-invalid');
        }

        const [requestedSnapshotDigest, projectedSnapshotDigest] = await Promise.all([
            sha256CanonicalJson(authorityBody.requestedSnapshot),
            sha256CanonicalJson(authorityBody.projectedSnapshot),
        ]);
        if (
            requestedSnapshotDigest !== args.metadata.requestedSnapshotDigest ||
            projectedSnapshotDigest !== args.metadata.projectedSnapshotDigest
        ) {
            throw new Error('blueprint-plan-snapshot-digest-mismatch');
        }

        const planDocument = {
            authorityDigest: args.metadata.authorityDigest,
            authorityVersion: 1 as const,
            blockerCount: args.metadata.blockerCount,
            creationRequestKey,
            createdAt,
            ...(args.metadata.createdByUserId ? { createdByUserId: args.metadata.createdByUserId } : {}),
            decisionCount: args.metadata.decisionCount,
            decisionLedgerBytes: 0,
            decisionLedgerDigest: args.metadata.decisionLedgerDigest,
            decisionSummary: args.metadata.decisionSummary,
            guildId,
            deleteStepCount: args.metadata.deleteStepCount,
            ...(args.metadata.deleteSetDigest ? { deleteSetDigest: args.metadata.deleteSetDigest } : {}),
            executionAuthorityDigest: args.metadata.executionAuthorityDigest,
            executionAuthorityVersion: 1 as const,
            planDigest: args.metadata.planDigest,
            planVersion: 4 as const,
            policy: args.metadata.policy,
            projectedSnapshotDigest: args.metadata.projectedSnapshotDigest,
            requestedSnapshotDigest: args.metadata.requestedSnapshotDigest,
            ...(sourceBackupId ? { sourceBackupId } : {}),
            status: 'draft' as const,
            stepCount: args.metadata.stepCount,
            stepLedgerBytes: 0,
            stepLedgerDigest: args.metadata.stepLedgerDigest,
            summary: args.metadata.summary,
            updatedAt: createdAt,
        };
        assertDocumentSize(planDocument, MAX_PLAN_METADATA_BYTES, 'blueprint-plan-metadata-too-large');

        const existing = await ctx.db
            .query('blueprintPlans')
            .withIndex('by_guild_creation_request', (q) =>
                q.eq('guildId', guildId).eq('creationRequestKey', creationRequestKey)
            )
            .order('desc')
            .first();
        if (existing && existing.status !== 'obsolete') {
            if (
                (existing.sourceBackupId ?? '') !== (sourceBackupId ?? '') ||
                (existing.createdByUserId ?? '') !== (args.metadata.createdByUserId ?? '')
            ) {
                throw new Error('blueprint-plan-creation-request-conflict');
            }
            return toPlanMetadataRecord(existing);
        }

        const planId = await ctx.db.insert('blueprintPlans', planDocument);
        const [authority, executionAuthorityPersistence] = await Promise.all([
            createBlueprintPlanAuthority({ planId: String(planId), guildId, body: authorityBody, createdAt }),
            createBlueprintPlanExecutionAuthorityPersistence({
                planId: String(planId),
                guildId,
                authority: executionBody,
                createdAt,
            }),
        ]);
        if (
            authority.authorityDigest !== args.metadata.authorityDigest ||
            executionAuthorityPersistence.authority.executionAuthorityDigest !== args.metadata.executionAuthorityDigest
        ) {
            throw new Error('blueprint-plan-authority-digest-mismatch');
        }
        const expectedPlanDigest = await createBlueprintPlanDigest({
            guildId,
            policy: args.metadata.policy,
            summary: args.metadata.summary,
            decisionSummary: args.metadata.decisionSummary,
            blockerCount: args.metadata.blockerCount,
            requestedSnapshotDigest,
            projectedSnapshotDigest,
            authorityDigest: authority.authorityDigest,
            executionAuthorityDigest: executionAuthorityPersistence.authority.executionAuthorityDigest,
            stepLedger: { count: args.metadata.stepCount, digest: args.metadata.stepLedgerDigest },
            decisionLedger: { count: args.metadata.decisionCount, digest: args.metadata.decisionLedgerDigest },
            deleteLedger: {
                count: args.metadata.deleteStepCount,
                digest: args.metadata.deleteSetDigest ?? null,
            },
        });
        if (expectedPlanDigest !== args.metadata.planDigest) {
            throw new Error('blueprint-plan-digest-mismatch');
        }
        assertDocumentSize(authority, MAX_PLAN_AUTHORITY_BYTES, 'blueprint-plan-authority-too-large');
        assertDocumentSize(
            executionAuthorityPersistence.manifest,
            MAX_PLAN_EXECUTION_AUTHORITY_MANIFEST_BYTES,
            'blueprint-plan-execution-authority-manifest-too-large'
        );
        for (const bucket of executionAuthorityPersistence.buckets) {
            assertDocumentSize(
                bucket,
                MAX_PLAN_EXECUTION_AUTHORITY_BUCKET_BYTES,
                'blueprint-plan-execution-authority-bucket-too-large'
            );
        }
        await ctx.db.insert('blueprintPlanAuthorities', {
            ...authority,
            planId,
        });
        await ctx.db.insert('blueprintPlanExecutionAuthorities', {
            ...executionAuthorityPersistence.manifest,
            planId,
        });
        for (const bucket of executionAuthorityPersistence.buckets) {
            await ctx.db.insert('blueprintPlanExecutionAuthorityBuckets', { ...bucket, planId });
        }
        return toPlanMetadataRecord({ ...planDocument, _id: planId });
    },
});

export const writeBlueprintPlanStepBatch = mutation({
    args: { now: v.string(), planId: v.id('blueprintPlans'), steps: v.array(stepEntryValidator) },
    returns: v.array(planStepRecordValidator),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const now = requireTimestamp(args.now, 'blueprint-plan-step-created-at-invalid');
        const plan = await requireDraftPlan(ctx, args.planId);
        if (args.steps.length < 1 || args.steps.length > 100) throw new Error('blueprint-plan-step-batch-size-invalid');
        const entries = args.steps.map((entry) => {
            const normalized = normalizeBlueprintPlanStep(entry.step);
            if (normalized.type === 'invalid') throw new Error('blueprint-plan-step-invalid');
            return { sequence: entry.sequence, step: normalized.value };
        });
        assertContiguousBatch(entries, plan.stepCount, 'blueprint-plan-step-sequence-invalid');
        const existing = await readStepSequenceRange(ctx, args.planId, entries);
        if (existing.length > 0) {
            if (
                existing.length !== entries.length ||
                existing.some(
                    (record, index) =>
                        record.sequence !== entries[index]?.sequence ||
                        canonicalJsonStringify(record.step) !== canonicalJsonStringify(entries[index].step)
                )
            ) {
                throw new Error('blueprint-plan-step-batch-conflict');
            }
            return existing.map(toPlanStepRecord);
        }
        await requireStepAppendPosition(ctx, args.planId, entries[0]?.sequence ?? 0);
        const batchBytes = entries.reduce(
            (total, entry) => total + getDocumentSize({ ...entry, planId: args.planId, createdAt: now }),
            0
        );
        if (plan.stepLedgerBytes + plan.decisionLedgerBytes + batchBytes > MAX_PLAN_LEDGER_BYTES) {
            throw new Error('blueprint-plan-ledger-too-large');
        }
        const records = [];
        for (const entry of entries) {
            const document = { ...entry, planId: args.planId, createdAt: now };
            assertDocumentSize(document, MAX_PLAN_STEP_BYTES, 'blueprint-plan-step-too-large');
            const id = await ctx.db.insert('blueprintPlanSteps', document);
            records.push({ id, planId: args.planId, createdAt: now, ...entry });
        }
        await ctx.db.patch('blueprintPlans', plan._id, {
            stepLedgerBytes: plan.stepLedgerBytes + batchBytes,
            updatedAt: now,
        });
        return records;
    },
});

export const writeBlueprintPlanDecisionBatch = mutation({
    args: { decisions: v.array(decisionEntryValidator), now: v.string(), planId: v.id('blueprintPlans') },
    returns: v.array(planDecisionRecordValidator),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const now = requireTimestamp(args.now, 'blueprint-plan-decision-created-at-invalid');
        const plan = await requireDraftPlan(ctx, args.planId);
        if (args.decisions.length < 1 || args.decisions.length > 100) {
            throw new Error('blueprint-plan-decision-batch-size-invalid');
        }
        const entries = args.decisions.map((entry) => {
            const normalized = normalizeBlueprintPlanDecision(entry.decision);
            if (normalized.type === 'invalid') throw new Error('blueprint-plan-decision-invalid');
            return { sequence: entry.sequence, decision: normalized.value };
        });
        assertContiguousBatch(entries, plan.decisionCount, 'blueprint-plan-decision-sequence-invalid');
        const existing = await readDecisionSequenceRange(ctx, args.planId, entries);
        if (existing.length > 0) {
            if (
                existing.length !== entries.length ||
                existing.some(
                    (record, index) =>
                        record.sequence !== entries[index]?.sequence ||
                        canonicalJsonStringify(record.decision) !== canonicalJsonStringify(entries[index].decision)
                )
            ) {
                throw new Error('blueprint-plan-decision-batch-conflict');
            }
            return existing.map(toPlanDecisionRecord);
        }
        await requireDecisionAppendPosition(ctx, args.planId, entries[0]?.sequence ?? 0);
        const batchBytes = entries.reduce(
            (total, entry) =>
                total +
                getDocumentSize({
                    decision: entry.decision as Value,
                    sequence: entry.sequence,
                    planId: args.planId,
                    createdAt: now,
                }),
            0
        );
        if (plan.stepLedgerBytes + plan.decisionLedgerBytes + batchBytes > MAX_PLAN_LEDGER_BYTES) {
            throw new Error('blueprint-plan-ledger-too-large');
        }
        const records = [];
        for (const entry of entries) {
            const id = await ctx.db.insert('blueprintPlanDecisions', { ...entry, planId: args.planId, createdAt: now });
            records.push({ id, planId: args.planId, createdAt: now, ...entry });
        }
        await ctx.db.patch('blueprintPlans', plan._id, {
            decisionLedgerBytes: plan.decisionLedgerBytes + batchBytes,
            updatedAt: now,
        });
        return records;
    },
});

export const finalizeBlueprintPlan = mutation({
    args: { audit: v.optional(auditInputValidator), now: v.string(), planId: v.id('blueprintPlans') },
    returns: planMetadataRecordValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web']);
        const now = requireTimestamp(args.now, 'blueprint-plan-finalized-at-invalid');
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (!plan) throw new Error('blueprint-plan-not-found');
        if (plan.status !== 'draft' && plan.status !== 'review_ready') {
            throw new Error('blueprint-plan-finalization-state-invalid');
        }
        await loadAndValidateBlueprintPlanAuthority(ctx, plan);
        if (plan.status === 'review_ready') return toPlanMetadataRecord(plan);

        const patch = { sealedAt: now, status: 'review_ready' as const, updatedAt: now };
        assertDocumentSize({ ...plan, ...patch }, MAX_PLAN_METADATA_BYTES, 'blueprint-plan-metadata-too-large');
        await ctx.db.patch('blueprintPlans', plan._id, patch);
        await recordBlueprintAuditInMutation(
            ctx,
            plan.guildId,
            args.audit ?? { action: 'blueprint.plan_created' },
            now,
            String(plan._id)
        );
        return toPlanMetadataRecord({ ...plan, ...patch });
    },
});

export const getBlueprintPlanMetadata = query({
    args: { guildId: v.string(), planId: v.id('blueprintPlans') },
    returns: v.union(planMetadataRecordValidator, v.null()),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        return plan?.guildId === args.guildId ? toPlanMetadataRecord(plan) : null;
    },
});

export const getBlueprintPlanAuthority = query({
    args: { guildId: v.string(), planId: v.id('blueprintPlans') },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (plan?.guildId !== args.guildId) return null;
        const authority = await ctx.db
            .query('blueprintPlanAuthorities')
            .withIndex('by_plan', (q) => q.eq('planId', args.planId))
            .unique();
        if (!authority) return null;
        const integrity = await validateBlueprintPlanAuthorityIntegrity(stripConvexMetadata(authority));
        if (
            integrity.type === 'invalid' ||
            integrity.value.planId !== String(plan._id) ||
            integrity.value.guildId !== plan.guildId ||
            integrity.value.authorityDigest !== plan.authorityDigest
        ) {
            throw new Error('blueprint-plan-authority-integrity-invalid');
        }
        return { ...integrity.value, id: authority._id };
    },
});

export const listBlueprintPlanStepsByPlanIdPage = query({
    args: {
        cursor: v.optional(v.union(v.string(), v.null())),
        guildId: v.string(),
        limit: v.optional(v.number()),
        planId: v.id('blueprintPlans'),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, ['web', 'bot']);
        const plan = await ctx.db.get('blueprintPlans', args.planId);
        if (plan?.guildId !== args.guildId) return { steps: [], nextCursor: null };
        const limit = Math.min(Math.max(Math.trunc(args.limit ?? 20), 1), 100);
        const cursor = parseSequenceCursor(args.cursor);
        const records = await ctx.db
            .query('blueprintPlanSteps')
            .withIndex('by_plan_sequence', (q) =>
                cursor === undefined ? q.eq('planId', args.planId) : q.eq('planId', args.planId).gt('sequence', cursor)
            )
            .order('asc')
            .take(limit + 1);
        const page = records.slice(0, limit);
        return {
            steps: page.map(toPlanStepRecord),
            nextCursor: records.length > page.length ? String(page.at(-1)?.sequence ?? '') : null,
        };
    },
});

function assertPlanMetadataInput(metadata: {
    blockerCount: number;
    decisionCount: number;
    decisionSummary: {
        noOp: number;
        create: number;
        update: number;
        delete: number;
        protectedRetained: number;
        protectedOmitted: number;
        unmanagedRetained: number;
        blockedAmbiguous: number;
        blockedUnsupported: number;
    };
    deleteStepCount: number;
    deleteSetDigest?: string;
    summary: { creates: number; updates: number; deletes: number; roles: number; categories: number; channels: number };
    stepCount: number;
    [key: string]: unknown;
}): void {
    for (const value of [metadata.blockerCount, metadata.decisionCount, metadata.deleteStepCount, metadata.stepCount]) {
        if (!isNonNegativeSafeInteger(value)) throw new Error('blueprint-plan-count-invalid');
    }
    const summary = metadata.summary;
    const decisionSummary = metadata.decisionSummary;
    for (const field of ['creates', 'updates', 'deletes', 'roles', 'categories', 'channels']) {
        if (!isNonNegativeSafeInteger(summary[field as keyof typeof summary])) {
            throw new Error('blueprint-plan-summary-invalid');
        }
    }
    for (const field of blueprintPlanDecisionSummaryFields) {
        if (!isNonNegativeSafeInteger(decisionSummary[field]))
            throw new Error('blueprint-plan-decision-summary-invalid');
    }
    const summarizedDecisionCount = blueprintPlanDecisionSummaryFields.reduce(
        (total, field) => total + decisionSummary[field],
        0
    );
    if (!Number.isSafeInteger(summarizedDecisionCount) || summarizedDecisionCount !== metadata.decisionCount) {
        throw new Error('blueprint-plan-decision-summary-count-mismatch');
    }
    for (const field of [
        'authorityDigest',
        'executionAuthorityDigest',
        'planDigest',
        'projectedSnapshotDigest',
        'requestedSnapshotDigest',
        'stepLedgerDigest',
        'decisionLedgerDigest',
    ]) {
        if (!isSha256(metadata[field])) throw new Error('blueprint-plan-digest-invalid');
    }
    if ((metadata.deleteStepCount === 0) !== (metadata.deleteSetDigest === undefined)) {
        throw new Error('blueprint-plan-delete-digest-invalid');
    }
    if (metadata.deleteSetDigest !== undefined && !isSha256(metadata.deleteSetDigest)) {
        throw new Error('blueprint-plan-delete-digest-invalid');
    }
}

export function assertPlanIntegrityMatches(
    plan: {
        authorityDigest: string;
        decisionCount: number;
        decisionLedgerDigest: string;
        deleteSetDigest?: string;
        deleteStepCount: number;
        executionAuthorityDigest: string;
        planDigest: string;
        projectedSnapshotDigest: string;
        requestedSnapshotDigest: string;
        stepCount: number;
        stepLedgerDigest: string;
        summary: Doc<'blueprintPlans'>['summary'];
        decisionSummary: Doc<'blueprintPlans'>['decisionSummary'];
        blockerCount: number;
    },
    integrity: Awaited<ReturnType<typeof createBlueprintPlanIntegrityDigests>>
): void {
    if (validateBlueprintPlanMetadataIntegrity(plan, integrity).type === 'invalid') {
        throw new Error('blueprint-plan-integrity-mismatch');
    }
}

export async function loadAndValidateBlueprintPlanAuthority(ctx: MutationCtx, plan: Doc<'blueprintPlans'>) {
    const [authorities, executionAuthorities, executionAuthorityBuckets, steps, decisions] = await Promise.all([
        ctx.db
            .query('blueprintPlanAuthorities')
            .withIndex('by_plan', (q) => q.eq('planId', plan._id))
            .take(2),
        ctx.db
            .query('blueprintPlanExecutionAuthorities')
            .withIndex('by_plan', (q) => q.eq('planId', plan._id))
            .take(2),
        ctx.db
            .query('blueprintPlanExecutionAuthorityBuckets')
            .withIndex('by_plan', (q) => q.eq('planId', plan._id))
            .collect(),
        ctx.db
            .query('blueprintPlanSteps')
            .withIndex('by_plan_sequence', (q) => q.eq('planId', plan._id))
            .order('asc')
            .collect(),
        ctx.db
            .query('blueprintPlanDecisions')
            .withIndex('by_plan_sequence', (q) => q.eq('planId', plan._id))
            .order('asc')
            .collect(),
    ]);
    if (authorities.length > 1 || executionAuthorities.length > 1) {
        throw new Error('blueprint-plan-authority-duplicate');
    }
    const authority = authorities[0];
    const executionAuthority = executionAuthorities[0];
    if (!authority || !executionAuthority) throw new Error('blueprint-plan-authority-missing');
    const authorityValue = stripConvexMetadata(authority);
    const [authorityResult, persistedExecutionResult] = await Promise.all([
        validateBlueprintPlanAuthorityIntegrity(authorityValue),
        validateBlueprintPlanExecutionAuthorityPersistence({
            manifest: stripConvexMetadata(executionAuthority),
            buckets: executionAuthorityBuckets.map(stripConvexMetadata),
        }),
    ]);
    if (authorityResult.type === 'invalid' || persistedExecutionResult.type === 'invalid') {
        throw new Error('blueprint-plan-authority-integrity-invalid');
    }
    const executionResult = await validateBlueprintPlanExecutionAuthorityIntegrity({
        executionAuthority: persistedExecutionResult.value,
        authority: authorityResult.value,
    });
    if (executionResult.type === 'invalid') throw new Error('blueprint-plan-authority-integrity-invalid');
    const normalizedSteps = steps.map((record) => {
        const normalized = normalizeBlueprintPlanStep(record.step);
        if (normalized.type === 'invalid') throw new Error('blueprint-plan-step-invalid');
        return { ...record, step: normalized.value };
    });
    const normalizedDecisions = decisions.map((record) => {
        const normalized = normalizeBlueprintPlanDecision(record.decision);
        if (normalized.type === 'invalid') throw new Error('blueprint-plan-decision-invalid');
        return { ...record, decision: normalized.value };
    });
    const integrity = await createBlueprintPlanIntegrityDigests({
        guildId: plan.guildId,
        policy: plan.policy,
        summary: plan.summary,
        authority: authorityResult.value,
        executionAuthority: executionResult.value,
        steps: normalizedSteps.map(({ sequence, step }) => ({ sequence, step })),
        decisions: normalizedDecisions.map(({ sequence, decision }) => ({ sequence, decision })),
    });
    assertPlanIntegrityMatches(plan, integrity);
    return {
        authority: authorityResult.value,
        authorityDocument: authority,
        decisions: normalizedDecisions,
        executionAuthority: executionResult.value,
        executionAuthorityDocument: { ...persistedExecutionResult.value, _id: executionAuthority._id },
        steps: normalizedSteps,
    };
}

export async function tryLoadAndValidateBlueprintPlanAuthority(ctx: MutationCtx, plan: Doc<'blueprintPlans'>) {
    try {
        return { type: 'valid' as const, value: await loadAndValidateBlueprintPlanAuthority(ctx, plan) };
    } catch (error) {
        const errorType = error instanceof Error ? error.message : '';
        if (!isDeterministicPlanAuthorityError(errorType)) throw error;
        return { type: 'invalid' as const, errorType };
    }
}

function isDeterministicPlanAuthorityError(errorType: string): boolean {
    return errorType.startsWith('blueprint-plan-') || errorType.startsWith('invalid-blueprint-plan-');
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function assertContiguousBatch(
    entries: ReadonlyArray<{ sequence: number }>,
    expectedCount: number,
    errorType: string
): void {
    const first = entries[0]?.sequence;
    if (
        first === undefined ||
        !Number.isInteger(first) ||
        first < 0 ||
        entries.some((entry, index) => entry.sequence !== first + index) ||
        first + entries.length > expectedCount
    ) {
        throw new Error(errorType);
    }
}

async function readStepSequenceRange(
    ctx: MutationCtx,
    planId: GenericId<'blueprintPlans'>,
    entries: ReadonlyArray<{ sequence: number }>
) {
    const first = entries[0]?.sequence ?? 0;
    const last = entries.at(-1)?.sequence ?? first;
    return ctx.db
        .query('blueprintPlanSteps')
        .withIndex('by_plan_sequence', (q) => q.eq('planId', planId).gte('sequence', first).lte('sequence', last))
        .order('asc')
        .take(entries.length + 1);
}

async function readDecisionSequenceRange(
    ctx: MutationCtx,
    planId: GenericId<'blueprintPlans'>,
    entries: ReadonlyArray<{ sequence: number }>
) {
    const first = entries[0]?.sequence ?? 0;
    const last = entries.at(-1)?.sequence ?? first;
    return ctx.db
        .query('blueprintPlanDecisions')
        .withIndex('by_plan_sequence', (q) => q.eq('planId', planId).gte('sequence', first).lte('sequence', last))
        .order('asc')
        .take(entries.length + 1);
}

async function requireStepAppendPosition(
    ctx: MutationCtx,
    planId: GenericId<'blueprintPlans'>,
    firstSequence: number
): Promise<void> {
    const latest = await ctx.db
        .query('blueprintPlanSteps')
        .withIndex('by_plan_sequence', (q) => q.eq('planId', planId))
        .order('desc')
        .first();
    if (firstSequence !== (latest?.sequence ?? -1) + 1) throw new Error('blueprint-plan-ledger-not-append');
}

async function requireDecisionAppendPosition(
    ctx: MutationCtx,
    planId: GenericId<'blueprintPlans'>,
    firstSequence: number
): Promise<void> {
    const latest = await ctx.db
        .query('blueprintPlanDecisions')
        .withIndex('by_plan_sequence', (q) => q.eq('planId', planId))
        .order('desc')
        .first();
    if (firstSequence !== (latest?.sequence ?? -1) + 1) throw new Error('blueprint-plan-ledger-not-append');
}

async function requireDraftPlan(ctx: MutationCtx, planId: GenericId<'blueprintPlans'>) {
    const plan = await ctx.db.get('blueprintPlans', planId);
    if (!plan) throw new Error('blueprint-plan-not-found');
    if (plan.status !== 'draft') throw new Error('blueprint-plan-ledger-immutable');
    return plan;
}

async function requireGuild(ctx: MutationCtx, guildId: string): Promise<void> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (q) => q.eq('guildId', guildId))
        .unique();
    if (!guild) throw new Error('guild-not-found');
}

async function requireSourceBackup(
    ctx: MutationCtx,
    guildId: string,
    sourceBackupId: string | null | undefined
): Promise<GenericId<'structureBackups'> | undefined> {
    if (!sourceBackupId) return undefined;
    const id = sourceBackupId as GenericId<'structureBackups'>;
    const backup = await ctx.db.get('structureBackups', id);
    if (backup?.guildId !== guildId) throw new Error('structure-backup-not-found');
    return id;
}

function toPlanStepRecord(record: { _id: string; createdAt: string; planId: string; sequence: number; step: unknown }) {
    return {
        id: record._id,
        planId: record.planId,
        createdAt: record.createdAt,
        sequence: record.sequence,
        step: record.step,
    };
}

function toPlanDecisionRecord(record: {
    _id: string;
    createdAt: string;
    decision: unknown;
    planId: string;
    sequence: number;
}) {
    return {
        id: record._id,
        planId: record.planId,
        createdAt: record.createdAt,
        sequence: record.sequence,
        decision: record.decision,
    };
}

function parseSequenceCursor(value: string | null | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function assertDocumentSize(value: unknown, maximum: number, errorType: string): void {
    if (!isRecord(value) || getDocumentSize(value as Record<string, Value>) > maximum) throw new Error(errorType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripConvexMetadata<T extends { _id: unknown; _creationTime: unknown }>(
    value: T
): Omit<T, '_id' | '_creationTime'> {
    const { _id: _id, _creationTime: _creationTime, ...document } = value;
    void _id;
    void _creationTime;
    return document;
}

function requireCanonicalText(value: string, errorType: string): string {
    if (value.length === 0 || value !== value.trim()) throw new Error(errorType);
    return value;
}

function requireTimestamp(value: string, errorType: string): string {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error(errorType);
    const canonical = new Date(parsed).toISOString();
    if (canonical !== value) throw new Error(errorType);
    return canonical;
}

function isSha256(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f\d]{64}$/.test(value);
}
