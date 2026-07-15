import { canonicalJsonStringify } from './canonical-json.js';
import { sha256CanonicalJson } from './canonical-hash.js';
import {
    createBlueprintPlanExecutionAuthorityContentDigest,
    createBlueprintPlanExecutionAuthorityDigestFromBody,
    createBlueprintPlanExecutionAuthorityPersistence,
} from './execution-authority.js';
import { parseBlueprintMutationFenceManifest, type BlueprintMutationFenceManifestV2 } from './mutation-fence.js';
import {
    BLUEPRINT_PLAN_VERSION,
    type BlueprintPlanDecisionSummary,
    type BlueprintPlanSummary,
    type BlueprintPolicy,
} from './plan.js';
import { summarizeBlueprintPlanDecisions } from './plan-summary.js';
import { normalizeBlueprintPreflightReport, type BlueprintPreflightReport } from './preflight-report.js';
import {
    BLUEPRINT_PLAN_AUTHORITY_VERSION,
    BLUEPRINT_PLAN_LEDGER_VERSION,
    type BlueprintPlanAuthorityBodyV1,
    type BlueprintPlanAuthorityV1,
    type BlueprintPlanDecisionLedgerEntryV1,
    type BlueprintPlanExecutionAuthorityBodyV1,
    type BlueprintPlanExecutionAuthorityV1,
    type BlueprintPlanStepLedgerEntryV1,
    type BlueprintPreflightEvidenceV1,
    type BlueprintRunVerificationEvidenceV1,
    type BlueprintVerificationResult,
    type BlueprintVerificationStatus,
    normalizeBlueprintPlanAuthority,
    normalizeBlueprintPlanAuthorityBody,
    normalizeBlueprintPlanDecisionLedger,
    normalizeBlueprintPlanExecutionAuthority,
    normalizeBlueprintPlanExecutionAuthorityBody,
    normalizeBlueprintPlanStepLedger,
    normalizeBlueprintPreflightEvidence,
    normalizeBlueprintRunVerificationEvidence,
} from './persisted-authority.js';
import type { BlueprintContractResult } from './runtime-contracts.js';
import { normalizeBlueprintSnapshot, type BlueprintSnapshot } from './snapshot.js';

export type BlueprintRunTerminalStatus =
    | 'succeeded'
    | 'partially_applied'
    | 'failed_before_mutation'
    | 'needs_reconciliation'
    | 'outcome_unknown'
    | 'cancelled';

export type BlueprintRunTerminalDigestInput = {
    runId: string;
    terminalRequestDigest: string;
    status: BlueprintRunTerminalStatus;
    errorType: string | null;
    restorePointBackupId: string | null;
    restorePointSnapshotDigest: string | null;
    verificationStatus: BlueprintVerificationStatus | null;
    verificationEvidenceDigest: string | null;
    progress: {
        appliedSteps: number;
        completedMutationSteps: number;
        failedSteps: number;
        nextStepSequence: number;
        notStartedSteps: number;
        skippedSteps: number;
        totalSteps: number;
        totalMutationSteps: number;
    };
};

export type BlueprintRunTerminalRequestDigestInput = {
    runId: string;
    requestedStatus: BlueprintRunTerminalStatus;
    errorType: string | null;
    sourceDigest: string | null;
    verificationStatus: BlueprintVerificationStatus | null;
    verificationEvidenceDigest: string | null;
    verificationResult: unknown;
};

export type BlueprintRunTerminalSourceKind =
    | 'step_completion'
    | 'control_request'
    | 'claim_expiry'
    | 'authorization_rejection'
    | 'authority_rejection';

export type BlueprintLedgerDigest = {
    count: number;
    digest: string;
};

export type BlueprintPlanIntegrityDigests = {
    requestedSnapshotDigest: string;
    projectedSnapshotDigest: string;
    authorityDigest: string;
    executionAuthorityDigest: string;
    stepCount: number;
    stepLedgerDigest: string;
    decisionCount: number;
    decisionLedgerDigest: string;
    deleteStepCount: number;
    deleteSetDigest: string | null;
    summary: BlueprintPlanSummary;
    decisionSummary: BlueprintPlanDecisionSummary;
    blockerCount: number;
    planDigest: string;
};

export type BlueprintPreflightEvidenceDigests = {
    reportDigest: string;
    manifestDigest: string;
    evidenceDigest: string;
};

export type BlueprintPlanDigestInput = {
    guildId: string;
    policy: BlueprintPolicy;
    summary: BlueprintPlanSummary;
    decisionSummary: BlueprintPlanDecisionSummary;
    blockerCount: number;
    requestedSnapshotDigest: string;
    projectedSnapshotDigest: string;
    authorityDigest: string;
    executionAuthorityDigest: string;
    stepLedger: BlueprintLedgerDigest;
    decisionLedger: BlueprintLedgerDigest;
    deleteLedger: { count: number; digest: string | null };
};

export { sha256CanonicalJson } from './canonical-hash.js';

export async function createBlueprintPlanCreationRequestKey(input: {
    authority: BlueprintPlanAuthorityBodyV1;
    blockerCount: number;
    createdByUserId?: string;
    decisionLedger: BlueprintLedgerDigest;
    decisionSummary: BlueprintPlanDecisionSummary;
    deleteLedger: { count: number; digest: string | null };
    executionAuthorityDigest: string;
    guildId: string;
    policy: BlueprintPolicy;
    sourceBackupId?: string;
    stepLedger: BlueprintLedgerDigest;
    summary: BlueprintPlanSummary;
}): Promise<string> {
    const authority = validOrThrow(
        normalizeBlueprintPlanAuthorityBody(input.authority),
        'blueprint-plan-authority-body-invalid'
    );
    const { requestedSnapshotStoredAt: _storedAt, ...stableProvenance } = authority.provenance;
    void _storedAt;
    return sha256CanonicalJson({
        domain: 'neonflux.blueprint.plan-creation-request',
        version: 1,
        guildId: input.guildId,
        policy: input.policy,
        summary: input.summary,
        decisionSummary: input.decisionSummary,
        blockerCount: input.blockerCount,
        authority: { ...authority, provenance: stableProvenance },
        executionAuthorityDigest: input.executionAuthorityDigest,
        stepLedger: input.stepLedger,
        decisionLedger: input.decisionLedger,
        deleteLedger: input.deleteLedger,
        ...(input.createdByUserId ? { createdByUserId: input.createdByUserId } : {}),
        ...(input.sourceBackupId ? { sourceBackupId: input.sourceBackupId } : {}),
    });
}

export async function createBlueprintPlanAuthority(input: {
    planId: string;
    guildId: string;
    body: BlueprintPlanAuthorityBodyV1;
    createdAt: string;
}): Promise<BlueprintPlanAuthorityV1> {
    const body = validOrThrow(normalizeBlueprintPlanAuthorityBody(input.body), 'blueprint-plan-authority-body-invalid');
    const authorityDigest = await createBlueprintPlanAuthorityDigest({ guildId: input.guildId, authority: body });
    return validOrThrow(
        normalizeBlueprintPlanAuthority({
            version: BLUEPRINT_PLAN_AUTHORITY_VERSION,
            planId: input.planId,
            guildId: input.guildId,
            ...body,
            authorityDigest,
            createdAt: input.createdAt,
        }),
        'blueprint-plan-authority-invalid'
    );
}

export function deriveBlueprintPlanExecutionAuthorityBody(
    authority: BlueprintPlanAuthorityBodyV1 | BlueprintPlanAuthorityV1
): BlueprintPlanExecutionAuthorityBodyV1 {
    const body = authorityBody(authority);
    return {
        ...(body.requestedSnapshot.guildId ? { sourceGuildId: body.requestedSnapshot.guildId } : {}),
        sourceTargetMap: { ...body.referenceAuthority.sourceTargetMap },
        knownTargetKinds: { ...body.referenceAuthority.knownTargetKinds },
        initialIdMap: Object.fromEntries(
            Object.entries(body.referenceAuthority.sourceTargetMap).filter(
                (entry): entry is [string, string] => entry[1] !== null
            )
        ),
    };
}

export async function deriveBlueprintPlanExecutionAuthority(input: {
    planId: string;
    guildId: string;
    authority: BlueprintPlanAuthorityBodyV1 | BlueprintPlanAuthorityV1;
    createdAt: string;
}): Promise<BlueprintPlanExecutionAuthorityV1> {
    const body = deriveBlueprintPlanExecutionAuthorityBody(input.authority);
    const persistence = await createBlueprintPlanExecutionAuthorityPersistence({
        planId: input.planId,
        guildId: input.guildId,
        authority: body,
        createdAt: input.createdAt,
    });
    return persistence.authority;
}

export async function createBlueprintPlanAuthorityDigest(input: {
    guildId: string;
    authority: BlueprintPlanAuthorityBodyV1 | BlueprintPlanAuthorityV1;
}): Promise<string> {
    const authority = authorityBody(input.authority);
    return sha256CanonicalJson({
        domain: 'neonflux.blueprint.authority',
        version: BLUEPRINT_PLAN_AUTHORITY_VERSION,
        guildId: input.guildId,
        ...authority,
    });
}

export async function createBlueprintPlanExecutionAuthorityDigest(input: {
    guildId: string;
    executionAuthority: BlueprintPlanExecutionAuthorityBodyV1 | BlueprintPlanExecutionAuthorityV1;
}): Promise<string> {
    const authority = executionAuthorityBody(input.executionAuthority);
    return createBlueprintPlanExecutionAuthorityDigestFromBody({
        guildId: input.guildId,
        authority,
    });
}

export async function createBlueprintStepLedgerDigest(value: unknown): Promise<BlueprintLedgerDigest> {
    const entries = validOrThrow(normalizeBlueprintPlanStepLedger(value), 'blueprint-plan-step-ledger-invalid');
    return {
        count: entries.length,
        digest: await sha256CanonicalJson({
            domain: 'neonflux.blueprint.step-ledger',
            version: BLUEPRINT_PLAN_LEDGER_VERSION,
            steps: entries,
        }),
    };
}

export async function createBlueprintDecisionLedgerDigest(value: unknown): Promise<BlueprintLedgerDigest> {
    const entries = validOrThrow(normalizeBlueprintPlanDecisionLedger(value), 'blueprint-plan-decision-ledger-invalid');
    return {
        count: entries.length,
        digest: await sha256CanonicalJson({
            domain: 'neonflux.blueprint.decision-ledger',
            version: BLUEPRINT_PLAN_LEDGER_VERSION,
            decisions: entries,
        }),
    };
}

export async function createBlueprintPlanDigest(input: BlueprintPlanDigestInput): Promise<string> {
    return sha256CanonicalJson({
        domain: 'neonflux.blueprint.plan',
        planVersion: BLUEPRINT_PLAN_VERSION,
        ...input,
    });
}

export async function createBlueprintPlanIntegrityDigests(input: {
    guildId: string;
    policy: BlueprintPolicy;
    summary: BlueprintPlanSummary;
    authority: BlueprintPlanAuthorityBodyV1 | BlueprintPlanAuthorityV1;
    executionAuthority: BlueprintPlanExecutionAuthorityBodyV1 | BlueprintPlanExecutionAuthorityV1;
    steps: BlueprintPlanStepLedgerEntryV1[];
    decisions: BlueprintPlanDecisionLedgerEntryV1[];
}): Promise<BlueprintPlanIntegrityDigests> {
    const authority = authorityBody(input.authority);
    const executionAuthority = executionAuthorityBody(input.executionAuthority);
    const steps = validOrThrow(normalizeBlueprintPlanStepLedger(input.steps), 'blueprint-plan-step-ledger-invalid');
    const decisions = validOrThrow(
        normalizeBlueprintPlanDecisionLedger(input.decisions),
        'blueprint-plan-decision-ledger-invalid'
    );
    const summary = normalizePlanSummary(input.summary);
    const decisionSummary = summarizeBlueprintPlanDecisions(decisions.map((entry) => entry.decision));
    const blockerCount = authority.blockers.length;
    const derivedExecutionAuthority = deriveBlueprintPlanExecutionAuthorityBody(authority);
    if (authority.roleProjection.mode !== input.policy) {
        throw new Error('blueprint-plan-policy-authority-mismatch');
    }
    if (
        authority.projectedSnapshot.guildId !== input.guildId ||
        authority.referenceAuthority.knownTargetKinds[input.guildId] !== 'role'
    ) {
        throw new Error('blueprint-plan-target-guild-authority-invalid');
    }
    if (canonicalJsonStringify(executionAuthority) !== canonicalJsonStringify(derivedExecutionAuthority)) {
        throw new Error('blueprint-plan-execution-authority-derivation-mismatch');
    }
    const [
        requestedSnapshotDigest,
        projectedSnapshotDigest,
        authorityDigest,
        executionAuthorityDigest,
        step,
        decision,
    ] = await Promise.all([
        sha256CanonicalJson(authority.requestedSnapshot),
        sha256CanonicalJson(authority.projectedSnapshot),
        createBlueprintPlanAuthorityDigest({ guildId: input.guildId, authority }),
        createBlueprintPlanExecutionAuthorityDigest({ guildId: input.guildId, executionAuthority }),
        createBlueprintStepLedgerDigest(steps),
        createBlueprintDecisionLedgerDigest(decisions),
    ]);
    const deleteSetKeys = steps
        .filter((entry) => entry.step.actionType === 'delete')
        .map((entry) => `${entry.step.targetType}:${entry.step.targetId}`)
        .sort();
    const deleteSetDigest = deleteSetKeys.length > 0 ? await sha256CanonicalJson(deleteSetKeys) : null;
    const planDigest = await createBlueprintPlanDigest({
        guildId: input.guildId,
        policy: input.policy,
        summary,
        decisionSummary,
        blockerCount,
        requestedSnapshotDigest,
        projectedSnapshotDigest,
        authorityDigest,
        executionAuthorityDigest,
        stepLedger: step,
        decisionLedger: decision,
        deleteLedger: { count: deleteSetKeys.length, digest: deleteSetDigest },
    });
    return {
        requestedSnapshotDigest,
        projectedSnapshotDigest,
        authorityDigest,
        executionAuthorityDigest,
        stepCount: step.count,
        stepLedgerDigest: step.digest,
        decisionCount: decision.count,
        decisionLedgerDigest: decision.digest,
        deleteStepCount: deleteSetKeys.length,
        deleteSetDigest,
        summary,
        decisionSummary,
        blockerCount,
        planDigest,
    };
}

export function validateBlueprintPlanMetadataIntegrity(
    expected: {
        requestedSnapshotDigest: string;
        projectedSnapshotDigest: string;
        authorityDigest: string;
        executionAuthorityDigest: string;
        stepCount: number;
        stepLedgerDigest: string;
        decisionCount: number;
        decisionLedgerDigest: string;
        deleteStepCount: number;
        deleteSetDigest?: string | null;
        summary: BlueprintPlanSummary;
        decisionSummary: BlueprintPlanDecisionSummary;
        blockerCount: number;
        planDigest: string;
    },
    actual: BlueprintPlanIntegrityDigests
): BlueprintContractResult<BlueprintPlanIntegrityDigests> {
    const equal =
        expected.requestedSnapshotDigest === actual.requestedSnapshotDigest &&
        expected.projectedSnapshotDigest === actual.projectedSnapshotDigest &&
        expected.authorityDigest === actual.authorityDigest &&
        expected.executionAuthorityDigest === actual.executionAuthorityDigest &&
        expected.stepCount === actual.stepCount &&
        expected.stepLedgerDigest === actual.stepLedgerDigest &&
        expected.decisionCount === actual.decisionCount &&
        expected.decisionLedgerDigest === actual.decisionLedgerDigest &&
        expected.deleteStepCount === actual.deleteStepCount &&
        (expected.deleteSetDigest ?? null) === actual.deleteSetDigest &&
        canonicalJsonStringify(expected.summary) === canonicalJsonStringify(actual.summary) &&
        canonicalJsonStringify(expected.decisionSummary) === canonicalJsonStringify(actual.decisionSummary) &&
        expected.blockerCount === actual.blockerCount &&
        expected.planDigest === actual.planDigest;
    return equal ? { type: 'valid', value: actual } : invalid('Blueprint plan metadata does not match its authority.');
}

export async function createBlueprintPreflightEvidenceDigests(input: {
    report: BlueprintPreflightReport;
    mutationFenceManifest: BlueprintMutationFenceManifestV2;
}): Promise<BlueprintPreflightEvidenceDigests> {
    const report = validOrThrow(normalizeBlueprintPreflightReport(input.report), 'blueprint-preflight-report-invalid');
    let mutationFenceManifest: BlueprintMutationFenceManifestV2;
    try {
        mutationFenceManifest = parseBlueprintMutationFenceManifest(input.mutationFenceManifest);
    } catch {
        throw new Error('blueprint-preflight-mutation-fence-invalid');
    }
    const [reportDigest, manifestDigest] = await Promise.all([
        sha256CanonicalJson(report),
        sha256CanonicalJson(mutationFenceManifest),
    ]);
    return {
        reportDigest,
        manifestDigest,
        evidenceDigest: await sha256CanonicalJson({
            domain: 'neonflux.blueprint.preflight-evidence',
            version: 1,
            report,
            mutationFenceManifest,
        }),
    };
}

export async function createBlueprintPreflightDigest(input: {
    planId: string;
    planDigest: string;
    status: 'ready' | 'blocked' | 'stale';
    checkedAt: string;
    observedAt: string;
    expiresAt: string;
    fingerprintVersion: 2;
    structureFingerprint: string;
    capabilityFingerprint: string;
    evidenceDigest: string;
}): Promise<string> {
    return sha256CanonicalJson({ domain: 'neonflux.blueprint.preflight', version: 1, ...input });
}

export async function createBlueprintRunVerificationEvidenceDigest(input: {
    runId: string;
    verificationStatus: BlueprintVerificationStatus;
    result: BlueprintVerificationResult;
}): Promise<string> {
    return sha256CanonicalJson({
        domain: 'neonflux.blueprint.run-verification',
        version: 1,
        runId: input.runId,
        verificationStatus: input.verificationStatus,
        result: input.result,
    });
}

export async function createBlueprintRestorePointSnapshotDigest(snapshot: BlueprintSnapshot): Promise<string> {
    const normalized = normalizeBlueprintSnapshot(snapshot);
    if (normalized.type === 'invalid') throw new Error('blueprint-restore-point-snapshot-invalid');
    return sha256CanonicalJson({
        domain: 'neonflux.blueprint.restore-point-snapshot',
        version: 1,
        snapshot: normalized.snapshot,
    });
}

export async function createBlueprintRunTerminalDigest(input: BlueprintRunTerminalDigestInput): Promise<string> {
    const counters = Object.values(input.progress);
    if (counters.some((value) => !Number.isSafeInteger(value) || value < 0)) {
        throw new Error('blueprint-run-terminal-progress-invalid');
    }
    return sha256CanonicalJson({
        domain: 'neonflux.blueprint.run-terminal',
        version: 1,
        runId: input.runId,
        terminalRequestDigest: input.terminalRequestDigest,
        status: input.status,
        errorType: input.errorType,
        restorePointBackupId: input.restorePointBackupId,
        restorePointSnapshotDigest: input.restorePointSnapshotDigest,
        verificationStatus: input.verificationStatus,
        verificationEvidenceDigest: input.verificationEvidenceDigest,
        progress: input.progress,
    });
}

export async function createBlueprintRunTerminalRequestDigest(
    input: BlueprintRunTerminalRequestDigestInput
): Promise<string> {
    const verificationResultDigest = await sha256CanonicalJson({
        domain: 'neonflux.blueprint.run-terminal-request-verification-result',
        version: 1,
        result: input.verificationResult,
    });
    return sha256CanonicalJson({
        domain: 'neonflux.blueprint.run-terminal-request',
        version: 1,
        runId: input.runId,
        requestedStatus: input.requestedStatus,
        errorType: input.errorType,
        sourceDigest: input.sourceDigest,
        verificationStatus: input.verificationStatus,
        verificationEvidenceDigest: input.verificationEvidenceDigest,
        verificationResultDigest,
    });
}

export function createBlueprintRunTerminalSourceDigest(input: {
    kind: BlueprintRunTerminalSourceKind;
    identity: unknown;
}): Promise<string> {
    return sha256CanonicalJson({
        domain: 'neonflux.blueprint.run-terminal-source',
        version: 1,
        kind: input.kind,
        identity: input.identity,
    });
}

export async function validateBlueprintPlanAuthorityIntegrity(
    authority: unknown
): Promise<BlueprintContractResult<BlueprintPlanAuthorityV1>> {
    const normalized = normalizeBlueprintPlanAuthority(authority);
    if (normalized.type === 'invalid') return normalized;
    const digest = await createBlueprintPlanAuthorityDigest({
        guildId: normalized.value.guildId,
        authority: normalized.value,
    });
    return digest === normalized.value.authorityDigest
        ? normalized
        : invalid('Blueprint plan authority digest does not match its contents.');
}

export async function validateBlueprintPlanExecutionAuthorityIntegrity(input: {
    executionAuthority: unknown;
    authority?: BlueprintPlanAuthorityBodyV1 | BlueprintPlanAuthorityV1;
}): Promise<BlueprintContractResult<BlueprintPlanExecutionAuthorityV1>> {
    const normalized = normalizeBlueprintPlanExecutionAuthority(input.executionAuthority);
    if (normalized.type === 'invalid') return normalized;
    const digest = await createBlueprintPlanExecutionAuthorityDigest({
        guildId: normalized.value.guildId,
        executionAuthority: normalized.value,
    });
    const contentDigest = await createBlueprintPlanExecutionAuthorityContentDigest({
        guildId: normalized.value.guildId,
        authority: executionAuthorityBody(normalized.value),
    });
    if (contentDigest !== normalized.value.contentDigest || digest !== normalized.value.executionAuthorityDigest) {
        return invalid('Blueprint plan execution authority digest does not match its contents.');
    }
    if (input.authority) {
        const derived = deriveBlueprintPlanExecutionAuthorityBody(authorityBody(input.authority));
        if (canonicalJsonStringify(derived) !== canonicalJsonStringify(executionAuthorityBody(normalized.value))) {
            return invalid('Blueprint plan execution authority does not match the full authority.');
        }
    }
    return normalized;
}

export async function validateBlueprintStepLedgerIntegrity(
    value: unknown,
    expected: BlueprintLedgerDigest
): Promise<BlueprintContractResult<BlueprintPlanStepLedgerEntryV1[]>> {
    const normalized = normalizeBlueprintPlanStepLedger(value);
    if (normalized.type === 'invalid') return normalized;
    const actual = await createBlueprintStepLedgerDigest(normalized.value);
    return actual.count === expected.count && actual.digest === expected.digest
        ? normalized
        : invalid('Blueprint plan step ledger digest does not match its contents.');
}

export async function validateBlueprintDecisionLedgerIntegrity(
    value: unknown,
    expected: BlueprintLedgerDigest
): Promise<BlueprintContractResult<BlueprintPlanDecisionLedgerEntryV1[]>> {
    const normalized = normalizeBlueprintPlanDecisionLedger(value);
    if (normalized.type === 'invalid') return normalized;
    const actual = await createBlueprintDecisionLedgerDigest(normalized.value);
    return actual.count === expected.count && actual.digest === expected.digest
        ? normalized
        : invalid('Blueprint plan decision ledger digest does not match its contents.');
}

export async function validateBlueprintPreflightEvidenceIntegrity(
    evidence: unknown
): Promise<BlueprintContractResult<BlueprintPreflightEvidenceV1>> {
    const normalized = normalizeBlueprintPreflightEvidence(evidence);
    if (normalized.type === 'invalid') return normalized;
    const digests = await createBlueprintPreflightEvidenceDigests(normalized.value);
    return digests.reportDigest === normalized.value.reportDigest &&
        digests.manifestDigest === normalized.value.manifestDigest &&
        digests.evidenceDigest === normalized.value.evidenceDigest
        ? normalized
        : invalid('Blueprint preflight evidence digests do not match its contents.');
}

export async function validateBlueprintRunVerificationEvidenceIntegrity(
    evidence: unknown
): Promise<BlueprintContractResult<BlueprintRunVerificationEvidenceV1>> {
    const normalized = normalizeBlueprintRunVerificationEvidence(evidence);
    if (normalized.type === 'invalid') return normalized;
    const digest = await createBlueprintRunVerificationEvidenceDigest(normalized.value);
    return digest === normalized.value.verificationEvidenceDigest
        ? normalized
        : invalid('Blueprint run verification evidence digest does not match its contents.');
}

function authorityBody(value: BlueprintPlanAuthorityBodyV1 | BlueprintPlanAuthorityV1): BlueprintPlanAuthorityBodyV1 {
    const candidate =
        'authorityDigest' in value
            ? {
                  requestedSnapshot: value.requestedSnapshot,
                  projectedSnapshot: value.projectedSnapshot,
                  roleProjection: value.roleProjection,
                  mappings: value.mappings,
                  referenceAuthority: value.referenceAuthority,
                  blockers: value.blockers,
                  provenance: value.provenance,
              }
            : value;
    return validOrThrow(normalizeBlueprintPlanAuthorityBody(candidate), 'blueprint-plan-authority-body-invalid');
}

function executionAuthorityBody(
    value: BlueprintPlanExecutionAuthorityBodyV1 | BlueprintPlanExecutionAuthorityV1
): BlueprintPlanExecutionAuthorityBodyV1 {
    const candidate =
        'executionAuthorityDigest' in value
            ? {
                  ...(value.sourceGuildId ? { sourceGuildId: value.sourceGuildId } : {}),
                  sourceTargetMap: value.sourceTargetMap,
                  knownTargetKinds: value.knownTargetKinds,
                  initialIdMap: value.initialIdMap,
              }
            : value;
    return validOrThrow(
        normalizeBlueprintPlanExecutionAuthorityBody(candidate),
        'blueprint-plan-execution-authority-body-invalid'
    );
}

function normalizePlanSummary(value: BlueprintPlanSummary): BlueprintPlanSummary {
    const fields = ['creates', 'updates', 'deletes', 'roles', 'categories', 'channels'] as const;
    if (fields.some((field) => !Number.isSafeInteger(value[field]) || value[field] < 0)) {
        throw new Error('blueprint-plan-summary-invalid');
    }
    return Object.fromEntries(fields.map((field) => [field, value[field]])) as BlueprintPlanSummary;
}

function validOrThrow<T>(result: BlueprintContractResult<T>, code: string): T {
    if (result.type === 'invalid') throw new Error(`${code}:${result.message}`);
    return result.value;
}

function invalid<T>(message: string): BlueprintContractResult<T> {
    return { type: 'invalid', message };
}
