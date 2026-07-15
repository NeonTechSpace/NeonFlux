import {
    normalizeBlueprintPlanAuthority,
    normalizeBlueprintPlanDecision,
    normalizeBlueprintPlanExecutionAuthority,
    normalizeBlueprintPlanStep,
    normalizeBlueprintPreflightEvidence,
    normalizeBlueprintRunCursor,
    normalizeBlueprintRunVerificationEvidence,
    type BlueprintContractResult,
} from '@neonflux/blueprint';

import type {
    BlueprintPlanApprovalRecord,
    BlueprintPlanAuthorityRecord,
    BlueprintPlanDecisionRecord,
    BlueprintPlanExecutionAuthorityRecord,
    BlueprintPlanMetadataRecord,
    BlueprintPlanPreflightEvidenceRecord,
    BlueprintPlanPreflightMetadataRecord,
    BlueprintPlanStepRecord,
    BlueprintRunCursorRecord,
    BlueprintRunRecord,
    BlueprintRunStepAttemptRecord,
    BlueprintRunVerificationEvidenceRecord,
} from './contracts-blueprint.js';

export function toBlueprintRun(input: unknown): BlueprintRunRecord {
    const record = recordValue(input);
    return {
        id: identifier(record),
        planId: stringValue(record.planId),
        guildId: stringValue(record.guildId),
        preflightId: stringValue(record.preflightId),
        preflightDigest: stringValue(record.preflightDigest),
        preflightExpiresAt: requiredDate(record.preflightExpiresAt),
        fingerprintVersion: literalNumberValue(record.fingerprintVersion, 2),
        expectedStructureFingerprint: stringValue(record.expectedStructureFingerprint),
        expectedCapabilityFingerprint: stringValue(record.expectedCapabilityFingerprint),
        executionAuthorityDigest: sha256Value(record.executionAuthorityDigest),
        authorizationDecision: nullableLiteral(record.authorizationDecision, [
            'authorized',
            'structure_changed',
            'capability_changed',
            'structure_and_capability_changed',
            'restore_observation_diverged',
            'preflight_expired',
            'fingerprint_version_mismatch',
        ]),
        authorizationMismatch: nullableJsonRecord(record.authorizationMismatch ?? record.authorizationMismatchJson),
        mutationAuthorizedAt: date(record.mutationAuthorizedAt),
        mutationAuthorizationLeaseId: nullableString(record.mutationAuthorizationLeaseId),
        protocolVersion: positiveIntegerValue(record.protocolVersion),
        status: literalValue(record.status, [
            'queued',
            'running',
            'waiting_rate_limit',
            'pause_requested',
            'paused',
            'verifying',
            'succeeded',
            'partially_applied',
            'failed_before_mutation',
            'needs_reconciliation',
            'outcome_unknown',
            'cancelled',
        ]),
        nextStepSequence: nonNegativeIntegerValue(record.nextStepSequence),
        totalSteps: nonNegativeIntegerValue(record.totalSteps),
        notStartedSteps: nonNegativeIntegerValue(record.notStartedSteps),
        phase: literalValue(record.phase, [
            'queued',
            'preparing',
            'create',
            'update',
            'delete',
            'channel_order',
            'role_order',
            'waiting_rate_limit',
            'paused',
            'verifying',
            'complete',
        ]),
        totalMutationSteps: nonNegativeIntegerValue(record.totalMutationSteps),
        completedMutationSteps: nonNegativeIntegerValue(record.completedMutationSteps),
        appliedSteps: nonNegativeIntegerValue(record.appliedSteps),
        failedSteps: nonNegativeIntegerValue(record.failedSteps),
        skippedSteps: nonNegativeIntegerValue(record.skippedSteps),
        retryAt: date(record.retryAt),
        errorType: nullableString(record.errorType),
        leaseId: nullableString(record.leaseId),
        currentStepDomain: nullableString(record.currentStepDomain),
        currentStepId: nullableString(record.currentStepId),
        currentStepLabel: nullableString(record.currentStepLabel),
        leaseOwner: nullableString(record.leaseOwner),
        leaseExpiresAt: date(record.leaseExpiresAt),
        heartbeatAt: date(record.heartbeatAt),
        startedAt: date(record.startedAt),
        completedAt: date(record.completedAt),
        controlRequest: nullableLiteral(record.controlRequest, ['pause', 'cancel']),
        restorePointBackupId: nullableString(record.restorePointBackupId),
        restorePointSnapshotDigest: nullableSha256Value(record.restorePointSnapshotDigest),
        verificationStatus: nullableLiteral(record.verificationStatus, ['matched', 'mismatch', 'read_failed']),
        verificationEvidenceVersion: nullableLiteralNumber(record.verificationEvidenceVersion, 1),
        verificationEvidenceDigest: nullableSha256Value(record.verificationEvidenceDigest),
        terminalDigest: nullableSha256Value(record.terminalDigest),
        terminalRequestDigest: nullableSha256Value(record.terminalRequestDigest),
        createdAt: requiredDate(record.createdAt),
        updatedAt: requiredDate(record.updatedAt),
    };
}

export function toBlueprintRunCursor(input: unknown): BlueprintRunCursorRecord {
    const record = recordValue(input);
    const value = unwrapContract(
        normalizeBlueprintRunCursor({
            version: record.version,
            runId: record.runId,
            planId: record.planId,
            idMap: record.idMap,
            updatedAt: record.updatedAt,
        }),
        'invalid-blueprint-run-cursor'
    );
    return { ...value, id: identifier(record), updatedAt: requiredDate(value.updatedAt) };
}

export function toBlueprintRunVerificationEvidence(input: unknown): BlueprintRunVerificationEvidenceRecord {
    const record = recordValue(input);
    const value = unwrapContract(
        normalizeBlueprintRunVerificationEvidence({
            version: record.version,
            runId: record.runId,
            planId: record.planId,
            verificationStatus: record.verificationStatus,
            result: record.result,
            verificationEvidenceDigest: record.verificationEvidenceDigest,
            createdAt: record.createdAt,
        }),
        'invalid-blueprint-run-verification-evidence'
    );
    return { ...value, id: identifier(record), createdAt: requiredDate(value.createdAt) };
}

export function toBlueprintRunStepAttempt(input: unknown): BlueprintRunStepAttemptRecord {
    const record = recordValue(input);
    return {
        id: identifier(record),
        runId: stringValue(record.runId),
        planStepId: stringValue(record.planStepId),
        planStepSequence: nonNegativeIntegerValue(record.planStepSequence),
        stepDigest: sha256Value(record.stepDigest),
        actionType: literalValue(record.actionType, ['create', 'update', 'delete']),
        targetType: literalValue(record.targetType, ['role', 'category', 'channel', 'role-order', 'channel-order']),
        targetId: stringValue(record.targetId),
        sourceId: nullableString(record.sourceId),
        displayLabel: stringValue(record.displayLabel),
        attempt: nonNegativeIntegerValue(record.attempt),
        state: literalValue(record.state, ['pending', 'started', 'applied', 'failed', 'unknown']),
        requestKey: stringValue(record.requestKey),
        completionDigest: nullableString(record.completionDigest),
        createdId: nullableString(record.createdId),
        errorType: nullableString(record.errorType),
        retryAt: date(record.retryAt),
        startedAt: date(record.startedAt),
        completedAt: date(record.completedAt),
        createdAt: requiredDate(record.createdAt),
        updatedAt: requiredDate(record.updatedAt),
    };
}

export function toDecision(input: unknown): BlueprintPlanDecisionRecord {
    const record = recordValue(input);
    const decision = unwrapContract(normalizeBlueprintPlanDecision(record.decision), 'invalid-blueprint-plan-decision');
    return {
        id: identifier(record),
        planId: stringValue(record.planId),
        sequence: nonNegativeIntegerValue(record.sequence),
        decision,
        createdAt: requiredDate(record.createdAt),
    };
}

export function toPreflightMetadata(input: unknown): BlueprintPlanPreflightMetadataRecord {
    const record = recordValue(input);
    return {
        id: identifier(record),
        planId: stringValue(record.planId),
        guildId: stringValue(record.guildId),
        status: literalValue(record.status, ['ready', 'blocked', 'stale']),
        summary: preflightSummaryValue(record.summary),
        checkedAt: requiredDate(record.checkedAt),
        observedAt: requiredDate(record.observedAt),
        expiresAt: requiredDate(record.expiresAt),
        observationSource: literalValue(record.observationSource, ['resident-client']),
        planDigest: stringValue(record.planDigest),
        fingerprintVersion: literalNumberValue(record.fingerprintVersion, 2),
        structureFingerprint: stringValue(record.structureFingerprint),
        capabilityFingerprint: stringValue(record.capabilityFingerprint),
        evidenceVersion: literalNumberValue(record.evidenceVersion, 1),
        evidenceDigest: stringValue(record.evidenceDigest),
        preflightDigest: stringValue(record.preflightDigest),
    };
}

export function toPreflightEvidence(input: unknown): BlueprintPlanPreflightEvidenceRecord {
    const record = recordValue(input);
    const value = unwrapContract(
        normalizeBlueprintPreflightEvidence({
            version: record.version,
            preflightId: record.preflightId,
            planId: record.planId,
            report: record.report,
            mutationFenceManifest: record.mutationFenceManifest,
            reportDigest: record.reportDigest,
            manifestDigest: record.manifestDigest,
            evidenceDigest: record.evidenceDigest,
            createdAt: record.createdAt,
        }),
        'invalid-blueprint-preflight-evidence'
    );
    return { ...value, id: identifier(record), createdAt: requiredDate(value.createdAt) };
}

export function toApproval(input: unknown): BlueprintPlanApprovalRecord {
    const record = recordValue(input);
    return {
        id: identifier(record),
        planId: stringValue(record.planId),
        planDigest: stringValue(record.planDigest),
        approvedByUserId: nullableString(record.approvedByUserId),
        approvedAt: requiredDate(record.approvedAt),
        deleteSetDigest: nullableString(record.deleteSetDigest),
        destructiveStepCount: nullableNumber(record.destructiveStepCount),
        destructiveApprovedAt: date(record.destructiveApprovedAt),
        destructivePreflightDigest: nullableString(record.destructivePreflightDigest),
        fingerprintVersion:
            record.fingerprintVersion === undefined || record.fingerprintVersion === null
                ? null
                : literalNumberValue(record.fingerprintVersion, 2),
        approvedStructureFingerprint: nullableString(record.approvedStructureFingerprint),
        approvedCapabilityFingerprint: nullableString(record.approvedCapabilityFingerprint),
        confirmationMethod: nullableLiteral(record.confirmationMethod, ['acknowledgement', 'target_name']),
    };
}

export function toBlueprintPlanMetadata(input: unknown): BlueprintPlanMetadataRecord {
    const record = recordValue(input);
    return {
        id: identifier(record),
        guildId: stringValue(record.guildId),
        sourceBackupId: nullableString(record.sourceBackupId),
        status: literalValue(record.status, ['draft', 'needs_input', 'review_ready', 'approved', 'obsolete']),
        policy: literalValue(record.policy, ['merge', 'synchronize', 'rebuild']),
        planVersion: literalNumberValue(record.planVersion, 4),
        summary: planSummaryValue(record.summary),
        decisionSummary: decisionSummaryValue(record.decisionSummary),
        blockerCount: nonNegativeIntegerValue(record.blockerCount),
        requestedSnapshotDigest: stringValue(record.requestedSnapshotDigest),
        projectedSnapshotDigest: stringValue(record.projectedSnapshotDigest),
        authorityVersion: literalNumberValue(record.authorityVersion, 1),
        authorityDigest: stringValue(record.authorityDigest),
        executionAuthorityVersion: literalNumberValue(record.executionAuthorityVersion, 1),
        executionAuthorityDigest: stringValue(record.executionAuthorityDigest),
        stepCount: nonNegativeIntegerValue(record.stepCount),
        stepLedgerDigest: stringValue(record.stepLedgerDigest),
        decisionCount: nonNegativeIntegerValue(record.decisionCount),
        decisionLedgerDigest: stringValue(record.decisionLedgerDigest),
        deleteStepCount: nonNegativeIntegerValue(record.deleteStepCount),
        deleteSetDigest: nullableString(record.deleteSetDigest),
        planDigest: stringValue(record.planDigest),
        createdByUserId: nullableString(record.createdByUserId),
        createdAt: requiredDate(record.createdAt),
        sealedAt: date(record.sealedAt),
        updatedAt: requiredDate(record.updatedAt),
    };
}

export function toBlueprintPlanAuthority(input: unknown): BlueprintPlanAuthorityRecord {
    const record = recordValue(input);
    const value = unwrapContract(
        normalizeBlueprintPlanAuthority({
            version: record.version,
            planId: record.planId,
            guildId: record.guildId,
            requestedSnapshot: record.requestedSnapshot,
            projectedSnapshot: record.projectedSnapshot,
            roleProjection: record.roleProjection,
            mappings: record.mappings,
            referenceAuthority: record.referenceAuthority,
            blockers: record.blockers,
            provenance: record.provenance,
            authorityDigest: record.authorityDigest,
            createdAt: record.createdAt,
        }),
        'invalid-blueprint-plan-authority'
    );
    return { ...value, id: identifier(record), createdAt: requiredDate(value.createdAt) };
}

export function toBlueprintPlanExecutionAuthority(input: unknown): BlueprintPlanExecutionAuthorityRecord {
    const record = recordValue(input);
    const value = unwrapContract(
        normalizeBlueprintPlanExecutionAuthority({
            version: record.version,
            planId: record.planId,
            guildId: record.guildId,
            ...(record.sourceGuildId === undefined ? {} : { sourceGuildId: record.sourceGuildId }),
            sourceTargetMap: record.sourceTargetMap,
            knownTargetKinds: record.knownTargetKinds,
            initialIdMap: record.initialIdMap,
            contentDigest: record.contentDigest,
            executionAuthorityDigest: record.executionAuthorityDigest,
            createdAt: record.createdAt,
        }),
        'invalid-blueprint-plan-execution-authority'
    );
    return { ...value, id: identifier(record), createdAt: requiredDate(value.createdAt) };
}

export function toBlueprintPlanStep(input: unknown): BlueprintPlanStepRecord {
    const record = recordValue(input);
    const step = unwrapContract(normalizeBlueprintPlanStep(record.step), 'invalid-blueprint-plan-step');
    return {
        id: identifier(record),
        planId: stringValue(record.planId),
        sequence: nonNegativeIntegerValue(record.sequence),
        step,
        createdAt: requiredDate(record.createdAt),
    };
}

export function recordValue(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid-record');
    return value as Record<string, unknown>;
}

export function arrayValue(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error('invalid-array');
    return value;
}

function unwrapContract<T>(result: BlueprintContractResult<T>, message: string): T {
    if (result.type === 'invalid') throw new Error(message);
    return result.value;
}

function identifier(record: Record<string, unknown>): string {
    return stringValue(record.id ?? record._id);
}

function stringValue(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) throw new Error('invalid-string');
    return value;
}

function sha256Value(value: unknown): string {
    const digest = stringValue(value);
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('invalid-sha256');
    return digest;
}

function nullableString(value: unknown): string | null {
    return value === undefined || value === null ? null : stringValue(value);
}

function nullableSha256Value(value: unknown): string | null {
    return value === undefined || value === null ? null : sha256Value(value);
}

function numberValue(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('invalid-number');
    return value;
}

function nonNegativeIntegerValue(value: unknown): number {
    const parsed = numberValue(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('invalid-non-negative-integer');
    return parsed;
}

function positiveIntegerValue(value: unknown): number {
    const parsed = numberValue(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('invalid-positive-integer');
    return parsed;
}

function literalNumberValue<const TValue extends number>(value: unknown, expected: TValue): TValue {
    if (value !== expected) throw new Error('invalid-number-literal');
    return expected;
}

function nullableLiteralNumber<const TValue extends number>(value: unknown, expected: TValue): TValue | null {
    return value === undefined || value === null ? null : literalNumberValue(value, expected);
}

function nullableNumber(value: unknown): number | null {
    return value === undefined || value === null ? null : numberValue(value);
}

function nullableJsonRecord(value: unknown): Record<string, unknown> | null {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') return recordValue(JSON.parse(value) as unknown);
    return recordValue(value);
}

function literalValue<const TValue extends string>(value: unknown, allowed: readonly TValue[]): TValue {
    if (typeof value !== 'string' || !allowed.includes(value as TValue)) throw new Error('invalid-literal');
    return value as TValue;
}

function nullableLiteral<const TValue extends string>(value: unknown, allowed: readonly TValue[]): TValue | null {
    return value === undefined || value === null ? null : literalValue(value, allowed);
}

function requiredDate(value: unknown): Date {
    if (typeof value !== 'string') throw new Error('invalid-date');
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error('invalid-date');
    return parsed;
}

function date(value: unknown): Date | null {
    return value === undefined || value === null ? null : requiredDate(value);
}

function countRecord<TField extends string>(value: unknown, fields: readonly TField[]): Record<TField, number> {
    const record = recordValue(value);
    if (
        Object.keys(record).length !== fields.length ||
        Object.keys(record).some((field) => !fields.includes(field as TField))
    ) {
        throw new Error('invalid-count-record');
    }
    return Object.fromEntries(fields.map((field) => [field, nonNegativeIntegerValue(record[field])])) as Record<
        TField,
        number
    >;
}

function planSummaryValue(value: unknown): BlueprintPlanMetadataRecord['summary'] {
    return countRecord(value, ['creates', 'updates', 'deletes', 'roles', 'categories', 'channels']);
}

function decisionSummaryValue(value: unknown): BlueprintPlanMetadataRecord['decisionSummary'] {
    return countRecord(value, [
        'noOp',
        'create',
        'update',
        'delete',
        'protectedRetained',
        'protectedOmitted',
        'unmanagedRetained',
        'blockedAmbiguous',
        'blockedUnsupported',
    ]);
}

function preflightSummaryValue(value: unknown): BlueprintPlanPreflightMetadataRecord['summary'] {
    return countRecord(value, [
        'total',
        'ready',
        'stale',
        'mappingRequired',
        'destructiveApprovalRequired',
        'unsupported',
        'invalidPlan',
    ]);
}
