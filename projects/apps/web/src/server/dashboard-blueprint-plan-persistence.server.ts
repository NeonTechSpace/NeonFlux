import '@tanstack/react-start/server-only';

import {
    blueprintAuditActions,
    createBlueprintPlanDraft,
    finalizeBlueprintPlan,
    getBlueprintPlanAuthority,
    getBlueprintPlanMetadata,
    listBlueprintPlanDecisionsPage,
    writeBlueprintPlanDecisionBatch,
    writeBlueprintPlanStepBatch,
} from '@neonflux/db';
import type { BlueprintPlanAuthorityRecord, BlueprintPlanStepRecord } from '@neonflux/db';
import {
    BLUEPRINT_ARTIFACT_MAX_BYTES,
    BLUEPRINT_PLAN_AUTHORITY_VERSION,
    BLUEPRINT_PLAN_COLD_MAX_BYTES,
    BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
    BLUEPRINT_PLAN_VERSION,
    canonicalJsonStringify,
    createBlueprintPlanAuthority,
    createBlueprintPlanIntegrityDigests,
    createBlueprintPlanCreationRequestKey,
    createBlueprintPlanExecutionAuthorityContentDigest,
    deriveBlueprintPlanExecutionAuthorityBody,
    normalizeBlueprintPlan,
    utf8ByteLength,
} from '@neonflux/blueprint';
import type {
    BlueprintPlanAuthorityBodyV1,
    BlueprintPlanDecision,
    BlueprintPlanDecisionLedgerEntryV1,
    BlueprintPlanStep,
    BlueprintPlanStepLedgerEntryV1,
} from '@neonflux/blueprint';

import { getWebDb } from './db.server.js';
import { loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import type { AuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import type { DashboardBlueprintPlan, DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import type { DashboardBlueprintPolicy, DashboardBlueprintPlanDecision } from './dashboard-blueprint-contracts.js';
import type { DashboardBlueprintErrorResult, DashboardBlueprintPlanResult } from './dashboard-blueprint-model.js';
import { dashboardPlanStepInlineLimit, toDashboardBlueprintPlan } from './dashboard-blueprint-records.server.js';
import type { BlueprintAuditPayload } from './dashboard-blueprint-records.server.js';

export type DashboardBlueprintDecisionPageInput = {
    cursor?: number;
    guildId: string;
    planId: string;
    limit?: number;
};

export type DashboardBlueprintDecisionPageResult =
    | { type: 'decision-page'; decisions: DashboardBlueprintPlanDecision[]; nextCursor?: number }
    | { type: 'invalid-input'; message: string }
    | DashboardBlueprintErrorResult;

export function createDashboardBlueprintPlanAuthority(
    plan: DashboardBlueprintPlan,
    requestedSnapshot: DashboardBlueprintSnapshot,
    options: {
        source?: string;
        requestedSnapshotStoredAt: string;
        sourcePlanId?: string;
        sourceRunId?: string;
    }
): BlueprintPlanAuthorityBodyV1 {
    const source = options.source ?? 'dashboard-json';
    if (source !== 'dashboard-json' && source !== 'backup' && source !== 'dashboard-recovery-plan') {
        throw new Error('invalid-blueprint-plan-provenance-source');
    }
    return {
        requestedSnapshot,
        projectedSnapshot: plan.projectedSnapshot,
        roleProjection: plan.roleProjection,
        mappings: plan.mappings,
        referenceAuthority: {
            sourceTargetMap: plan.sourceTargetMap,
            knownTargetKinds: plan.knownTargetKinds,
        },
        blockers: plan.blockers,
        provenance: {
            source,
            requestedGuildId: requestedSnapshot.guildId ?? null,
            requestedExportedAt: requestedSnapshot.exportedAt ?? null,
            requestedSnapshotStoredAt: options.requestedSnapshotStoredAt,
            ...(options.sourcePlanId ? { sourcePlanId: options.sourcePlanId } : {}),
            ...(options.sourceRunId ? { sourceRunId: options.sourceRunId } : {}),
        },
    };
}

export async function persistDashboardBlueprintPlan(
    context: AuthorizedBlueprintContext,
    plan: DashboardBlueprintPlan,
    requestedSnapshot: DashboardBlueprintSnapshot,
    options: {
        audit?: (planId: string) => BlueprintAuditPayload;
        policy: DashboardBlueprintPolicy;
        planMetadata?: Record<string, unknown>;
        roleMappings?: Record<string, string>;
        categoryMappings?: Record<string, string>;
        channelMappings?: Record<string, string>;
        source?: string;
        sourceBackupId?: string;
    }
): Promise<DashboardBlueprintPlanResult> {
    const normalizedPlan = normalizeBlueprintPlan(plan);
    if (normalizedPlan.type === 'invalid') {
        return { type: 'invalid-input', message: normalizedPlan.message };
    }
    plan = normalizedPlan.value;
    const database = await getWebDb();
    const now = new Date();
    const createdAt = now.toISOString();
    const sourcePlanId = readOptionalMetadataText(options.planMetadata, 'sourcePlanId');
    const sourceRunId = readOptionalMetadataText(options.planMetadata, 'sourceRunId');
    const authority = createDashboardBlueprintPlanAuthority(plan, requestedSnapshot, {
        source: options.source,
        requestedSnapshotStoredAt: createdAt,
        ...(sourcePlanId ? { sourcePlanId } : {}),
        ...(sourceRunId ? { sourceRunId } : {}),
    });
    const executionAuthority = deriveBlueprintPlanExecutionAuthorityBody(authority);
    const steps: BlueprintPlanStepLedgerEntryV1[] = plan.steps.map((step, sequence) => ({ sequence, step }));
    const decisions: BlueprintPlanDecisionLedgerEntryV1[] = plan.decisions.map((decision, sequence) => ({
        sequence,
        decision,
    }));
    let integrity: Awaited<ReturnType<typeof createBlueprintPlanIntegrityDigests>>;
    let executionAuthorityContentDigest: string;
    try {
        [integrity, executionAuthorityContentDigest] = await Promise.all([
            createBlueprintPlanIntegrityDigests({
                guildId: context.guild.id,
                policy: options.policy,
                summary: plan.summary,
                authority,
                executionAuthority,
                steps,
                decisions,
            }),
            createBlueprintPlanExecutionAuthorityContentDigest({
                guildId: context.guild.id,
                authority: executionAuthority,
            }),
        ]);
    } catch {
        return { type: 'invalid-input', message: 'The generated Blueprint authority could not be sealed.' };
    }
    try {
        const sizingAuthority = await createBlueprintPlanAuthority({
            body: authority,
            createdAt,
            guildId: context.guild.id,
            planId: 'x'.repeat(64),
        });
        if (utf8ByteLength(canonicalJsonStringify(sizingAuthority)) > BLUEPRINT_ARTIFACT_MAX_BYTES) {
            return {
                type: 'invalid-input',
                message: 'The generated Blueprint authority exceeds the 4 MiB safety limit.',
            };
        }
        const coldEnvelopeBytes = utf8ByteLength(
            canonicalJsonStringify({
                authority: sizingAuthority,
                decisions,
                executionAuthority,
                steps,
            })
        );
        if (coldEnvelopeBytes > BLUEPRINT_PLAN_COLD_MAX_BYTES) {
            return {
                type: 'invalid-input',
                message: 'The generated Blueprint plan exceeds the 12 MiB persisted-data safety limit.',
            };
        }
    } catch {
        return { type: 'invalid-input', message: 'The generated Blueprint authority could not be validated.' };
    }

    const draftResult = await createBlueprintPlanDraft(database.db, {
        guildId: context.guild.id,
        createdByUserId: context.actor.actorUserId,
        creationRequestKey: await createBlueprintPlanCreationRequestKey({
            authority,
            blockerCount: integrity.blockerCount,
            createdByUserId: context.actor.actorUserId,
            decisionLedger: { count: integrity.decisionCount, digest: integrity.decisionLedgerDigest },
            decisionSummary: integrity.decisionSummary,
            deleteLedger: { count: integrity.deleteStepCount, digest: integrity.deleteSetDigest },
            executionAuthorityDigest: integrity.executionAuthorityDigest,
            guildId: context.guild.id,
            policy: options.policy,
            ...(options.sourceBackupId ? { sourceBackupId: options.sourceBackupId } : {}),
            stepLedger: { count: integrity.stepCount, digest: integrity.stepLedgerDigest },
            summary: plan.summary,
        }),
        planVersion: BLUEPRINT_PLAN_VERSION,
        policy: options.policy,
        summary: plan.summary,
        decisionSummary: integrity.decisionSummary,
        blockerCount: integrity.blockerCount,
        requestedSnapshotDigest: integrity.requestedSnapshotDigest,
        projectedSnapshotDigest: integrity.projectedSnapshotDigest,
        authorityVersion: BLUEPRINT_PLAN_AUTHORITY_VERSION,
        authorityDigest: integrity.authorityDigest,
        executionAuthorityVersion: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
        executionAuthorityDigest: integrity.executionAuthorityDigest,
        stepCount: integrity.stepCount,
        stepLedgerDigest: integrity.stepLedgerDigest,
        decisionCount: integrity.decisionCount,
        decisionLedgerDigest: integrity.decisionLedgerDigest,
        deleteStepCount: integrity.deleteStepCount,
        ...(integrity.deleteSetDigest ? { deleteSetDigest: integrity.deleteSetDigest } : {}),
        planDigest: integrity.planDigest,
        authority: {
            version: BLUEPRINT_PLAN_AUTHORITY_VERSION,
            ...authority,
            authorityDigest: integrity.authorityDigest,
        },
        executionAuthority: {
            version: BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
            ...executionAuthority,
            contentDigest: executionAuthorityContentDigest,
            executionAuthorityDigest: integrity.executionAuthorityDigest,
        },
        now,
        ...(options.sourceBackupId ? { sourceBackupId: options.sourceBackupId } : {}),
    });
    if (draftResult.isErr()) {
        return draftResult.error.type === 'blueprint-plan-too-large'
            ? { type: 'invalid-input', message: 'The generated Blueprint plan exceeds its persistence safety limit.' }
            : { type: 'database-error' };
    }

    const planId = draftResult.value.id;
    let finalizedPlan = draftResult.value;
    let stepRecords: BlueprintPlanStepRecord[] = [];
    if (draftResult.value.status === 'draft') {
        const decisionWrite = await writeDecisionBatches(planId, decisions, now);
        if (decisionWrite === 'too-large') {
            return {
                type: 'invalid-input',
                message: 'The generated Blueprint plan exceeds its persistence safety limit.',
            };
        }
        if (decisionWrite === 'database-error') return { type: 'database-error' };
        const writtenSteps = await writeStepBatches(planId, steps, now);
        if (writtenSteps === 'too-large') {
            return {
                type: 'invalid-input',
                message: 'The generated Blueprint plan exceeds its persistence safety limit.',
            };
        }
        if (writtenSteps === 'database-error') return { type: 'database-error' };
        stepRecords = writtenSteps;
        const finalized = await finalizeBlueprintPlan(database.db, {
            planId,
            now: new Date(),
            audit: options.audit?.(planId) ?? {
                action: blueprintAuditActions.planCreated,
                actorUserId: context.actor.actorUserId,
                targetId: planId,
                metadata: { source: 'dashboard', planDigest: draftResult.value.planDigest },
            },
        });
        if (finalized.isErr()) return { type: 'database-error' };
        finalizedPlan = finalized.value;
    }
    let persistedAuthority: BlueprintPlanAuthorityRecord;
    try {
        const localAuthority = await createBlueprintPlanAuthority({
            body: authority,
            createdAt: finalizedPlan.createdAt.toISOString(),
            guildId: context.guild.id,
            planId,
        });
        if (localAuthority.authorityDigest === finalizedPlan.authorityDigest) {
            persistedAuthority = {
                ...localAuthority,
                createdAt: new Date(localAuthority.createdAt),
                id: planId,
            };
        } else {
            const storedAuthority = await getBlueprintPlanAuthority(database.db, {
                guildId: context.guild.id,
                planId,
            });
            if (storedAuthority.isErr() || storedAuthority.value.authorityDigest !== finalizedPlan.authorityDigest) {
                return { type: 'database-error' };
            }
            persistedAuthority = storedAuthority.value;
        }
    } catch {
        return { type: 'database-error' };
    }
    return {
        type: 'plan-created',
        plan: toDashboardBlueprintPlan(finalizedPlan, {
            authority: persistedAuthority,
            steps: stepRecords,
        }),
    };
}

async function writeStepBatches(
    planId: string,
    steps: Array<{ sequence: number; step: BlueprintPlanStep }>,
    now: Date
): Promise<BlueprintPlanStepRecord[] | 'database-error' | 'too-large'> {
    if (steps.length === 0) return [];
    const database = await getWebDb();
    const records: BlueprintPlanStepRecord[] = [];
    for (let offset = 0; offset < steps.length; offset += 100) {
        const result = await writeBlueprintPlanStepBatch(database.db, {
            planId,
            now,
            steps: steps.slice(offset, offset + 100),
        });
        if (result.isErr()) return result.error.type === 'blueprint-plan-too-large' ? 'too-large' : 'database-error';
        if (records.length < dashboardPlanStepInlineLimit) {
            records.push(...result.value.slice(0, dashboardPlanStepInlineLimit - records.length));
        }
    }
    return records;
}

async function writeDecisionBatches(
    planId: string,
    decisions: Array<{ sequence: number; decision: BlueprintPlanDecision }>,
    now: Date
): Promise<'ok' | 'database-error' | 'too-large'> {
    if (decisions.length === 0) return 'ok';
    const database = await getWebDb();
    for (let offset = 0; offset < decisions.length; offset += 100) {
        const result = await writeBlueprintPlanDecisionBatch(database.db, {
            planId,
            now,
            decisions: decisions.slice(offset, offset + 100),
        });
        if (result.isErr()) return result.error.type === 'blueprint-plan-too-large' ? 'too-large' : 'database-error';
    }
    return 'ok';
}

export async function readDashboardBlueprintPlanDecisionPage(
    request: Request,
    input: DashboardBlueprintDecisionPageInput
): Promise<DashboardBlueprintDecisionPageResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const planId = input.planId.trim();
    if (!planId) return { type: 'invalid-input', message: 'Choose a Blueprint plan.' };
    const database = await getWebDb();
    const plan = await getBlueprintPlanMetadata(database.db, { guildId: context.guild.id, planId });
    if (plan.isErr()) return plan.error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
    const page = await listBlueprintPlanDecisionsPage(database.db, {
        guildId: context.guild.id,
        planId,
        cursor: input.cursor,
        limit: Math.min(Math.max(input.limit ?? 50, 1), 100),
    });
    if (page.isErr()) return page.error.type === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
    return {
        type: 'decision-page',
        decisions: page.value.decisions.map(({ id, decision }) => toDashboardPlanDecision(id, decision)),
        ...(page.value.nextCursor !== null ? { nextCursor: page.value.nextCursor } : {}),
    };
}

function toDashboardPlanDecision(id: string, decision: BlueprintPlanDecision): DashboardBlueprintPlanDecision {
    const logicalId = decision.sourceId ?? decision.targetId ?? id;
    return {
        logicalId,
        targetType: decision.targetType,
        name: logicalId,
        classification: decision.classification,
        ...(decision.sourceId ? { sourceId: decision.sourceId } : {}),
        ...(decision.targetId ? { targetId: decision.targetId } : {}),
        fields: decision.changes?.map((change) => change.field) ?? [],
        reason: decision.reason,
    };
}

function readOptionalMetadataText(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = metadata?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
