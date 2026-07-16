import '@tanstack/react-start/server-only';

import {
    createBlueprintPlanIntegrityDigests,
    deriveBlueprintPlanExecutionAuthorityBody,
    validateBlueprintPlanMetadataIntegrity,
} from '@neonflux/blueprint';
import type { BlueprintPreflightReport } from '@neonflux/blueprint';
import {
    getBlueprintPlanAuthority,
    getBlueprintPlanPreflightEvidence,
    getBlueprintPlanMetadata,
    getBlueprintRunVerificationEvidence,
    listAllBlueprintPlanStepsByPlanId,
    listBlueprintPlanDecisionsPage,
} from '@neonflux/db';
import type {
    BlueprintPlanAuthorityRecord,
    BlueprintPlanDecisionRecord,
    BlueprintPlanMetadataRecord,
    BlueprintPlanStepRecord,
    BlueprintRepositoryError,
    BlueprintRunVerificationEvidenceRecord,
} from '@neonflux/db';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { getWebDb } from './db.server.js';
import { loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import type {
    DashboardBlueprintErrorResult,
    DashboardBlueprintPlanColdDetail,
    DashboardBlueprintVerification,
} from './dashboard-blueprint-model.js';
import { mapRepositoryError } from './dashboard-blueprint-records.server.js';

export type DashboardBlueprintPlanAuthorityInput = { guildId: string; planId: string };
export type DashboardBlueprintPlanAuthorityResult =
    | { type: 'plan-authority'; detail: DashboardBlueprintPlanColdDetail }
    | { type: 'invalid-input'; message: string }
    | DashboardBlueprintErrorResult;

export async function readDashboardBlueprintPlanAuthority(
    request: Request,
    input: DashboardBlueprintPlanAuthorityInput
): Promise<DashboardBlueprintPlanAuthorityResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const planId = input.planId.trim();
    if (!planId) return { type: 'invalid-input', message: 'Choose a Blueprint plan to inspect.' };
    const database = await getWebDb();
    const authority = await getBlueprintPlanAuthority(database.db, { guildId: context.guild.id, planId });
    if (authority.isErr()) return mapRepositoryError(authority.error);
    if (authority.value.planId !== planId || authority.value.guildId !== context.guild.id) {
        return { type: 'database-error' };
    }
    return {
        type: 'plan-authority',
        detail: {
            id: authority.value.planId,
            requestedSnapshot: authority.value.requestedSnapshot,
            requestedSnapshotStoredAt: authority.value.provenance.requestedSnapshotStoredAt,
        },
    };
}

export type DashboardBlueprintPreflightEvidenceInput = { guildId: string; preflightId: string };
export type DashboardBlueprintPreflightEvidenceResult =
    | { type: 'preflight-evidence'; preflightId: string; report: BlueprintPreflightReport }
    | { type: 'invalid-input'; message: string }
    | DashboardBlueprintErrorResult;

export async function readDashboardBlueprintPreflightEvidence(
    request: Request,
    input: DashboardBlueprintPreflightEvidenceInput
): Promise<DashboardBlueprintPreflightEvidenceResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const preflightId = input.preflightId.trim();
    if (!preflightId) return { type: 'invalid-input', message: 'Choose a preflight report to inspect.' };
    const database = await getWebDb();
    const evidence = await getBlueprintPlanPreflightEvidence(database.db, {
        guildId: context.guild.id,
        preflightId,
    });
    if (evidence.isErr()) return mapRepositoryError(evidence.error);
    return { type: 'preflight-evidence', preflightId, report: evidence.value.report };
}

export type DashboardBlueprintVerificationEvidenceInput = { guildId: string; runId: string };
export type DashboardBlueprintVerificationEvidenceResult =
    | { type: 'verification-evidence'; runId: string; verification: DashboardBlueprintVerification }
    | { type: 'invalid-input'; message: string }
    | DashboardBlueprintErrorResult;

export async function readDashboardBlueprintVerificationEvidence(
    request: Request,
    input: DashboardBlueprintVerificationEvidenceInput
): Promise<DashboardBlueprintVerificationEvidenceResult> {
    const context = await loadAuthorizedBlueprintContext(request, input.guildId);
    if (context.type !== 'authorized') return context;
    const runId = input.runId.trim();
    if (!runId) return { type: 'invalid-input', message: 'Choose a completed run to inspect.' };
    const database = await getWebDb();
    const evidence = await getBlueprintRunVerificationEvidence(database.db, { guildId: context.guild.id, runId });
    if (evidence.isErr()) return mapRepositoryError(evidence.error);
    return { type: 'verification-evidence', runId, verification: toDashboardBlueprintVerification(evidence.value) };
}

function toDashboardBlueprintVerification(
    evidence: BlueprintRunVerificationEvidenceRecord
): DashboardBlueprintVerification {
    if (evidence.result.status === 'read_failed') {
        return {
            status: 'read-failed',
            verifiedAt: evidence.createdAt.toISOString(),
            failureReason: evidence.result.reason,
        };
    }
    return {
        status: evidence.result.status,
        verifiedAt: evidence.createdAt.toISOString(),
        expectedStructureDigest: evidence.result.expectedStructureDigest,
        actualStructureDigest: evidence.result.actualStructureDigest,
    };
}

export type DashboardBlueprintPlanAuthorityDetail = {
    plan: BlueprintPlanMetadataRecord;
    authority: BlueprintPlanAuthorityRecord;
    steps: BlueprintPlanStepRecord[];
    decisions: BlueprintPlanDecisionRecord[];
};

export async function loadDashboardBlueprintPlanAuthorityDetail(
    guildId: string,
    planId: string
): Promise<Result<DashboardBlueprintPlanAuthorityDetail, BlueprintRepositoryError>> {
    const database = await getWebDb();
    const [plan, authority, steps, decisions] = await Promise.all([
        getBlueprintPlanMetadata(database.db, { guildId, planId }),
        getBlueprintPlanAuthority(database.db, { guildId, planId }),
        listAllBlueprintPlanStepsByPlanId(database.db, { guildId, planId }),
        listAllBlueprintPlanDecisions(database.db, guildId, planId),
    ]);
    if (plan.isErr()) return err(plan.error);
    if (authority.isErr()) return err(authority.error);
    if (steps.isErr()) return err(steps.error);
    if (decisions.isErr()) return err(decisions.error);
    try {
        const integrity = await createBlueprintPlanIntegrityDigests({
            guildId: plan.value.guildId,
            policy: plan.value.policy,
            summary: plan.value.summary,
            authority: authority.value,
            executionAuthority: deriveBlueprintPlanExecutionAuthorityBody(authority.value),
            steps: steps.value.map(({ sequence, step }) => ({ sequence, step })),
            decisions: decisions.value.map(({ sequence, decision }) => ({ sequence, decision })),
        });
        if (
            authority.value.planId !== plan.value.id ||
            authority.value.guildId !== plan.value.guildId ||
            validateBlueprintPlanMetadataIntegrity(plan.value, integrity).type === 'invalid'
        ) {
            return err({ field: 'planAuthority', type: 'invalid-value' });
        }
    } catch {
        return err({ field: 'planAuthority', type: 'invalid-value' });
    }
    return ok({ plan: plan.value, authority: authority.value, steps: steps.value, decisions: decisions.value });
}

async function listAllBlueprintPlanDecisions(
    database: Awaited<ReturnType<typeof getWebDb>>['db'],
    guildId: string,
    planId: string
): Promise<Result<BlueprintPlanDecisionRecord[], BlueprintRepositoryError>> {
    const decisions: BlueprintPlanDecisionRecord[] = [];
    let cursor: number | undefined;
    do {
        const page = await listBlueprintPlanDecisionsPage(database, {
            guildId,
            planId,
            limit: 100,
            ...(cursor === undefined ? {} : { cursor }),
        });
        if (page.isErr()) return err(page.error);
        decisions.push(...page.value.decisions);
        cursor = page.value.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return ok(decisions);
}
