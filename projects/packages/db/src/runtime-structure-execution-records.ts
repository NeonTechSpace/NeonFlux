import type {
    StructureImportActionAttemptRecord,
    StructureImportActionRecord,
    StructureImportApprovalRecord,
    StructureImportDecisionRecord,
    StructureImportExecutionRecord,
    StructureImportPreflightRecord,
    StructureImportRunRecord,
} from './contracts-structure.js';

export function toExecution(input: unknown): StructureImportExecutionRecord {
    const record = recordValue(input);
    return {
        id: identifier(record),
        runId: stringValue(record.runId),
        guildId: stringValue(record.guildId),
        preflightDigest: stringValue(record.preflightDigest),
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
        nextActionSequence: numberValue(record.nextActionSequence),
        totalActions: numberValue(record.totalActions),
        notStartedActions: numberValue(record.notStartedActions),
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
        totalMutationSteps: numberValue(record.totalMutationSteps),
        completedMutationSteps: numberValue(record.completedMutationSteps),
        appliedActions: numberValue(record.appliedActions),
        failedActions: numberValue(record.failedActions),
        skippedActions: numberValue(record.skippedActions),
        idMap: stringMapValue(record.idMap),
        retryAt: date(record.retryAt),
        errorType: nullableString(record.errorType),
        leaseId: nullableString(record.leaseId),
        currentActionDomain: nullableString(record.currentActionDomain),
        currentActionId: nullableString(record.currentActionId),
        currentActionLabel: nullableString(record.currentActionLabel),
        leaseOwner: nullableString(record.leaseOwner),
        leaseExpiresAt: date(record.leaseExpiresAt),
        heartbeatAt: date(record.heartbeatAt),
        startedAt: date(record.startedAt),
        completedAt: date(record.completedAt),
        controlRequest: nullableLiteral(record.controlRequest, ['pause', 'cancel']),
        restorePointBackupId: nullableString(record.restorePointBackupId),
        verificationResult: nullableRecord(record.verificationResult),
        verificationStatus: nullableLiteral(record.verificationStatus, ['matched', 'mismatch', 'read_failed']),
        createdAt: requiredDate(record.createdAt),
        updatedAt: requiredDate(record.updatedAt),
    };
}

export function toAttempt(input: unknown): StructureImportActionAttemptRecord {
    const record = recordValue(input);
    return {
        id: identifier(record),
        executionId: stringValue(record.executionId),
        actionId: stringValue(record.actionId),
        attempt: numberValue(record.attempt),
        state: literalValue(record.state, ['pending', 'started', 'applied', 'failed', 'unknown']),
        requestKey: stringValue(record.requestKey),
        createdId: nullableString(record.createdId),
        errorType: nullableString(record.errorType),
        retryAt: date(record.retryAt),
        startedAt: date(record.startedAt),
        completedAt: date(record.completedAt),
        createdAt: requiredDate(record.createdAt),
        updatedAt: requiredDate(record.updatedAt),
    };
}

export function toDecision(input: unknown): StructureImportDecisionRecord {
    const record = recordValue(input);
    return {
        id: identifier(record),
        runId: stringValue(record.runId),
        sequence: numberValue(record.sequence),
        targetType: stringValue(record.targetType),
        classification: stringValue(record.classification),
        sourceId: nullableString(record.sourceId),
        targetId: nullableString(record.targetId),
        logicalId: nullableString(record.logicalId),
        name: nullableString(record.name),
        details: recordValue(record.details),
        createdAt: requiredDate(record.createdAt),
    };
}

export function toPreflight(input: unknown): StructureImportPreflightRecord {
    const record = recordValue(input);
    return {
        id: identifier(record),
        runId: stringValue(record.runId),
        planDigest: stringValue(record.planDigest),
        liveFingerprint: stringValue(record.liveFingerprint),
        preflightDigest: stringValue(record.preflightDigest),
        report: recordValue(record.report),
        status: literalValue(record.status, ['ready', 'blocked', 'stale']),
        checkedAt: requiredDate(record.checkedAt),
        expiresAt: requiredDate(record.expiresAt),
    };
}

export function toApproval(input: unknown): StructureImportApprovalRecord {
    const record = recordValue(input);
    return {
        id: identifier(record),
        runId: stringValue(record.runId),
        planDigest: stringValue(record.planDigest),
        approvedByUserId: nullableString(record.approvedByUserId),
        approvedAt: requiredDate(record.approvedAt),
        deleteSetDigest: nullableString(record.deleteSetDigest),
        destructiveActionCount: nullableNumber(record.destructiveActionCount),
        destructiveApprovedAt: date(record.destructiveApprovedAt),
        destructivePreflightDigest: nullableString(record.destructivePreflightDigest),
    };
}

export function toRun(input: unknown): StructureImportRunRecord {
    const record = recordValue(input);
    return {
        id: identifier(record),
        guildId: stringValue(record.guildId),
        deleteActionCount: numberValue(record.deleteActionCount),
        deleteSetDigest: nullableString(record.deleteSetDigest),
        planDigest: stringValue(record.planDigest),
        planVersion: numberValue(record.planVersion),
        policy: literalValue(record.policy, ['merge', 'synchronize', 'rebuild']),
        createdByUserId: nullableString(record.createdByUserId),
        status: stringValue(record.status),
        sourceBackupId: nullableString(record.sourceBackupId),
        plan: recordValue(record.plan),
        requestedSnapshotDigest: stringValue(record.requestedSnapshotDigest),
        createdAt: requiredDate(record.createdAt),
        updatedAt: requiredDate(record.updatedAt),
    };
}

export function toAction(input: unknown): StructureImportActionRecord {
    const record = recordValue(input);
    return {
        id: identifier(record),
        runId: stringValue(record.runId),
        sequence: numberValue(record.sequence),
        actionType: stringValue(record.actionType),
        targetType: stringValue(record.targetType),
        targetId: nullableString(record.targetId),
        details: recordValue(record.details),
        createdAt: requiredDate(record.createdAt),
    };
}

export function recordValue(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid-record');
    return value as Record<string, unknown>;
}

export function arrayValue(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error('invalid-array');
    return value as unknown[];
}

function identifier(record: Record<string, unknown>): string {
    return stringValue(record.id ?? record._id);
}

function stringValue(value: unknown): string {
    if (typeof value !== 'string') throw new Error('invalid-string');
    return value;
}

function nullableString(value: unknown): string | null {
    return value === undefined || value === null ? null : stringValue(value);
}

function numberValue(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('invalid-number');
    return value;
}

function positiveIntegerValue(value: unknown): number {
    const parsed = numberValue(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('invalid-positive-integer');
    return parsed;
}

function nullableNumber(value: unknown): number | null {
    return value === undefined || value === null ? null : numberValue(value);
}

function stringMapValue(value: unknown): Record<string, string> {
    const record = recordValue(value);
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, stringValue(item)]));
}

function nullableRecord(value: unknown): Record<string, unknown> | null {
    return value === undefined || value === null ? null : recordValue(value);
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
