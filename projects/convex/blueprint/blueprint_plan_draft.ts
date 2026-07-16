import { canonicalJsonStringify } from '@neonflux/blueprint/canonical-json';
import { createBlueprintPlanExecutionAuthorityPersistence } from '@neonflux/blueprint/execution-authority';
import {
    createBlueprintPlanAuthority,
    createBlueprintPlanCreationRequestKey,
    createBlueprintPlanDigest,
    deriveBlueprintPlanExecutionAuthorityBody,
    sha256CanonicalJson,
} from '@neonflux/blueprint/integrity';
import { blueprintPlanDecisionSummaryFields } from '@neonflux/blueprint/plan-summary';
import {
    normalizeBlueprintPlanAuthorityBody,
    normalizeBlueprintPlanExecutionAuthorityBody,
} from '@neonflux/blueprint/persisted-authority';
import { v, type GenericId, type Infer } from 'convex/values';

import type { MutationCtx } from '../_generated/server.js';
import { requireNeonFluxService } from '../auth.js';
import { toPlanMetadataRecord } from './blueprint_hot_records.js';
import {
    assertDocumentSize,
    isRecord,
    isSha256,
    MAX_PLAN_AUTHORITY_BYTES,
    MAX_PLAN_EXECUTION_AUTHORITY_BUCKET_BYTES,
    MAX_PLAN_EXECUTION_AUTHORITY_MANIFEST_BYTES,
    MAX_PLAN_METADATA_BYTES,
    requireCanonicalText,
    requireTimestamp,
} from './blueprint_plan_persistence_values.js';

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

export const blueprintPlanDraftArgs = {
    authority: v.any(),
    creationRequestKey: v.string(),
    executionAuthority: v.any(),
    metadata: metadataInputValidator,
    now: v.string(),
};

type BlueprintPlanDraftArgs = Infer<ReturnType<typeof v.object<typeof blueprintPlanDraftArgs>>>;

export async function createBlueprintPlanDraftHandler(ctx: MutationCtx, args: BlueprintPlanDraftArgs) {
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
}

function assertPlanMetadataInput(metadata: BlueprintPlanDraftArgs['metadata']): void {
    for (const value of [metadata.blockerCount, metadata.decisionCount, metadata.deleteStepCount, metadata.stepCount]) {
        if (!isNonNegativeSafeInteger(value)) throw new Error('blueprint-plan-count-invalid');
    }
    const summary = metadata.summary;
    const decisionSummary = metadata.decisionSummary;
    for (const field of ['creates', 'updates', 'deletes', 'roles', 'categories', 'channels'] as const) {
        if (!isNonNegativeSafeInteger(summary[field])) {
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
    ] as const) {
        if (!isSha256(metadata[field])) throw new Error('blueprint-plan-digest-invalid');
    }
    if ((metadata.deleteStepCount === 0) !== (metadata.deleteSetDigest === undefined)) {
        throw new Error('blueprint-plan-delete-digest-invalid');
    }
    if (metadata.deleteSetDigest !== undefined && !isSha256(metadata.deleteSetDigest)) {
        throw new Error('blueprint-plan-delete-digest-invalid');
    }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
