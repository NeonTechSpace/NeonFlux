import {
    BLUEPRINT_PLAN_AUTHORITY_VERSION,
    BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION,
    BLUEPRINT_PLAN_VERSION,
    BLUEPRINT_RUN_PROTOCOL_VERSION,
    createBlueprintPlanIntegrityDigests,
    normalizeBlueprintRunCursor,
    validateBlueprintDecisionLedgerIntegrity,
    validateBlueprintPlanAuthorityIntegrity,
    validateBlueprintPlanExecutionAuthorityIntegrity,
    validateBlueprintPlanMetadataIntegrity,
    validateBlueprintStepLedgerIntegrity,
    type BlueprintPlanAuthorityV1,
    type BlueprintPlanDecisionLedgerEntryV1,
    type BlueprintPlanExecutionAuthorityV1,
    type BlueprintPlanStep,
    type BlueprintPlanStepLedgerEntryV1,
    type BlueprintRunCursorV1,
} from '@neonflux/blueprint';
import type { BlueprintRunClaimRecord, BlueprintPlanStepRecord } from '@neonflux/db';

type ClaimedBlueprintRun = Extract<BlueprintRunClaimRecord, { kind: 'claimed' }>;

type BlueprintWorkerPlanStep = BlueprintPlanStepRecord & {
    actionType: BlueprintPlanStep['actionType'];
    targetType: BlueprintPlanStep['targetType'];
    targetId: string | null;
    details: BlueprintPlanStep['details'] & { label: string };
};

type ValidatedBlueprintRunAuthority = {
    authority: BlueprintPlanAuthorityV1;
    executionAuthority: BlueprintPlanExecutionAuthorityV1;
    cursor: BlueprintRunCursorV1;
    steps: BlueprintWorkerPlanStep[];
    decisions: BlueprintPlanDecisionLedgerEntryV1[];
};

export type BlueprintRunAuthorityValidation =
    | { type: 'valid'; value: ValidatedBlueprintRunAuthority }
    | { type: 'invalid'; errorType: string };

export async function validateClaimedBlueprintRunAuthority(
    claim: ClaimedBlueprintRun
): Promise<BlueprintRunAuthorityValidation> {
    const { run, plan } = claim;
    if (
        runtimeVersion(run.protocolVersion) !== BLUEPRINT_RUN_PROTOCOL_VERSION ||
        runtimeVersion(plan.planVersion) !== BLUEPRINT_PLAN_VERSION ||
        runtimeVersion(plan.authorityVersion) !== BLUEPRINT_PLAN_AUTHORITY_VERSION ||
        runtimeVersion(plan.executionAuthorityVersion) !== BLUEPRINT_PLAN_EXECUTION_AUTHORITY_VERSION
    ) {
        return invalid('blueprint-run-authority-version-mismatch');
    }
    if (
        run.planId !== plan.id ||
        run.guildId !== plan.guildId ||
        run.executionAuthorityDigest !== plan.executionAuthorityDigest ||
        run.totalSteps !== plan.stepCount ||
        run.nextStepSequence > plan.stepCount ||
        plan.status !== 'approved'
    ) {
        return invalid('blueprint-run-plan-metadata-mismatch');
    }

    const { id: _authorityRecordId, createdAt: authorityCreatedAt, ...authorityFields } = claim.authority;
    void _authorityRecordId;
    const authority = await validateBlueprintPlanAuthorityIntegrity({
        ...authorityFields,
        createdAt: authorityCreatedAt.toISOString(),
    });
    if (authority.type === 'invalid') return invalid('invalid-blueprint-plan-authority');
    if (authority.value.planId !== plan.id || authority.value.guildId !== plan.guildId) {
        return invalid('blueprint-run-plan-authority-link-mismatch');
    }
    if (plan.blockerCount !== authority.value.blockers.length || plan.blockerCount !== 0) {
        return invalid('blueprint-run-plan-blocker-mismatch');
    }

    const {
        id: _executionAuthorityRecordId,
        createdAt: executionAuthorityCreatedAt,
        ...executionAuthorityFields
    } = claim.executionAuthority;
    void _executionAuthorityRecordId;
    const executionAuthority = await validateBlueprintPlanExecutionAuthorityIntegrity({
        executionAuthority: {
            ...executionAuthorityFields,
            createdAt: executionAuthorityCreatedAt.toISOString(),
        },
        authority: authority.value,
    });
    if (executionAuthority.type === 'invalid') {
        return invalid('invalid-blueprint-plan-execution-authority');
    }
    if (
        executionAuthority.value.planId !== plan.id ||
        executionAuthority.value.guildId !== plan.guildId ||
        executionAuthority.value.executionAuthorityDigest !== run.executionAuthorityDigest
    ) {
        return invalid('blueprint-run-execution-authority-link-mismatch');
    }

    const { id: _cursorRecordId, updatedAt: cursorUpdatedAt, ...cursorFields } = claim.cursor;
    void _cursorRecordId;
    const cursor = normalizeBlueprintRunCursor({
        ...cursorFields,
        updatedAt: cursorUpdatedAt.toISOString(),
    });
    if (cursor.type === 'invalid') {
        return invalid('invalid-blueprint-run-cursor');
    }
    if (cursor.value.runId !== run.id || cursor.value.planId !== plan.id) {
        return invalid('blueprint-run-cursor-link-mismatch');
    }

    if (claim.steps.some((entry) => entry.planId !== plan.id)) {
        return invalid('blueprint-run-step-ledger-link-mismatch');
    }
    const stepLedger: BlueprintPlanStepLedgerEntryV1[] = claim.steps.map(({ sequence, step }) => ({
        sequence,
        step,
    }));
    const steps = await validateBlueprintStepLedgerIntegrity(stepLedger, {
        count: plan.stepCount,
        digest: plan.stepLedgerDigest,
    });
    if (steps.type === 'invalid') return invalid('invalid-blueprint-plan-step-ledger');

    if (claim.decisions.some((entry) => entry.planId !== plan.id)) {
        return invalid('blueprint-run-decision-ledger-link-mismatch');
    }
    const decisionLedger: BlueprintPlanDecisionLedgerEntryV1[] = claim.decisions.map(({ sequence, decision }) => ({
        sequence,
        decision,
    }));
    const decisions = await validateBlueprintDecisionLedgerIntegrity(decisionLedger, {
        count: plan.decisionCount,
        digest: plan.decisionLedgerDigest,
    });
    if (decisions.type === 'invalid') return invalid('invalid-blueprint-plan-decision-ledger');

    let digests;
    try {
        digests = await createBlueprintPlanIntegrityDigests({
            guildId: plan.guildId,
            policy: plan.policy,
            summary: plan.summary,
            authority: authority.value,
            executionAuthority: executionAuthority.value,
            steps: steps.value,
            decisions: decisions.value,
        });
    } catch {
        return invalid('invalid-blueprint-plan-integrity');
    }
    const metadataIntegrity = validateBlueprintPlanMetadataIntegrity(plan, digests);
    if (
        metadataIntegrity.type === 'invalid' ||
        digests.authorityDigest !== authority.value.authorityDigest ||
        digests.executionAuthorityDigest !== executionAuthority.value.executionAuthorityDigest
    ) {
        return invalid('blueprint-run-plan-digest-mismatch');
    }

    return {
        type: 'valid',
        value: {
            authority: authority.value,
            executionAuthority: executionAuthority.value,
            cursor: cursor.value,
            steps: claim.steps.map((record, index) => {
                const ledgerEntry = steps.value[index];
                if (!ledgerEntry) throw new Error('blueprint-run-step-ledger-length-mismatch');
                const step = ledgerEntry.step;
                return {
                    ...record,
                    step,
                    actionType: step.actionType,
                    targetType: step.targetType,
                    targetId: step.targetId,
                    details: { ...step.details, label: step.label },
                };
            }),
            decisions: decisions.value,
        },
    };
}

function invalid(errorType: string): BlueprintRunAuthorityValidation {
    return { type: 'invalid', errorType };
}

function runtimeVersion(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}
