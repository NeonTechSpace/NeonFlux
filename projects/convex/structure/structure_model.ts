import type { GenericId } from 'convex/values';

export const STRUCTURE_BACKUP_SOURCE = {
    manual: 'manual',
    restorePoint: 'restore_point',
    scheduled: 'scheduled',
} as const;

export const STRUCTURE_BACKUP_STATUS = {
    failed: 'failed',
    succeeded: 'succeeded',
} as const;

export const STRUCTURE_BACKUP_NAME_MAX_LENGTH = 120;
export const STRUCTURE_BACKUP_RETENTION_DAYS_DEFAULT = 180;
export const STRUCTURE_BACKUP_RETENTION_DAYS_MAX = 180;
export const STRUCTURE_DRIFT_CHECK_INTERVAL_DAYS = 1;

export const STRUCTURE_SCHEDULED_DRIFT_STATUS = {
    changed: 'changed',
    clean: 'clean',
    failed: 'failed',
    noBaseline: 'no_baseline',
} as const;

export const STRUCTURE_IMPORT_RUN_STATUS = {
    building: 'building',
    needsMapping: 'needs_mapping',
    reviewReady: 'review_ready',
    approved: 'approved',
    stale: 'stale',
} as const;

export type StructureBackupInput = {
    categoryCount?: number | null;
    channelCount?: number | null;
    completedAt?: string | null;
    createdAt?: string | null;
    createdByUserId?: string | null;
    errorMessage?: string | null;
    guildId?: string | null;
    deleteActionCount?: number | null;
    name?: string | null;
    roleCount?: number | null;
    serverName?: string | null;
    sortKey?: string | null;
    source?: string | null;
    status?: string | null;
    structure?: Record<string, unknown> | null;
};

export type StructureBackupDocument = {
    categoryCount: number;
    channelCount: number;
    completedAt: string;
    createdAt: string;
    createdByUserId?: string;
    errorMessage?: string;
    guildId: string;
    name: string;
    roleCount: number;
    sortKey: string;
    source: string;
    status: string;
    structure?: Record<string, unknown>;
};

export type StructureBackupSettingsInput = {
    cadenceWeeks?: number | null;
    enabled?: boolean | null;
    guildId?: string | null;
    retentionDays?: number | null;
};

export type StructureBackupSettingsDocument = {
    backupLeaseExpiresAt?: string;
    backupLeaseId?: string;
    backupLeaseOwner?: string;
    backupLeaseStartedAt?: string;
    cadenceWeeks: number;
    createdAt: string;
    driftLeaseExpiresAt?: string;
    driftLeaseId?: string;
    driftLeaseOwner?: string;
    driftLeaseStartedAt?: string;
    enabled: boolean;
    guildId: string;
    lastDriftBaselineBackupId?: string;
    lastDriftBaselineName?: string;
    lastDriftChangeCount?: number;
    lastDriftCheckedAt?: string;
    lastDriftErrorMessage?: string;
    lastDriftFieldSummary?: Record<string, unknown>;
    lastDriftHasMorePreview?: boolean;
    lastDriftLiveCounts?: Record<string, unknown>;
    lastDriftStatus?: string;
    lastDriftSummary?: Record<string, unknown>;
    lastAttemptAt?: string;
    lastErrorMessage?: string;
    lastSuccessAt?: string;
    nextBackupAt?: string;
    nextDriftCheckAt?: string;
    nextRetentionPruneAt?: string;
    retentionDays: number;
    updatedAt: string;
};

export type StructureScheduledDriftResultInput = {
    baselineBackupId?: string | null;
    baselineName?: string | null;
    changeCount?: number | null;
    errorMessage?: string | null;
    fieldSummary?: Record<string, unknown> | null;
    hasMorePreview?: boolean | null;
    liveCounts?: Record<string, unknown> | null;
    status?: string | null;
    summary?: Record<string, unknown> | null;
};

export type StructureImportRunInput = {
    createdAt?: string | null;
    createdByUserId?: string | null;
    guildId?: string | null;
    deleteActionCount?: number | null;
    deleteSetDigest?: string | null;
    planDigest?: string | null;
    planVersion?: number | null;
    policy?: string | null;
    plan?: Record<string, unknown> | null;
    requestedSnapshotDigest?: string | null;
    sourceBackupId?: string | null;
    status?: string | null;
    updatedAt?: string | null;
};

export type StructureImportRunDocument = {
    createdAt: string;
    createdByUserId?: string;
    guildId: string;
    deleteActionCount: number;
    deleteSetDigest?: string;
    planDigest: string;
    planVersion: number;
    policy: 'merge' | 'synchronize' | 'rebuild';
    plan: Record<string, unknown>;
    requestedSnapshotDigest: string;
    sourceBackupId?: GenericId<'structureBackups'>;
    status: 'building' | 'needs_mapping' | 'review_ready' | 'approved' | 'stale';
    updatedAt: string;
};

export type StructureImportActionInput = {
    actionType?: string | null;
    createdAt?: string | null;
    details?: Record<string, unknown> | null;
    runId?: string | null;
    sequence?: number | null;
    targetId?: string | null;
    targetType?: string | null;
};

export type StructureImportActionDocument = {
    actionType: 'create' | 'update' | 'delete';
    createdAt: string;
    details: Record<string, unknown>;
    runId: GenericId<'structureImportRuns'>;
    sequence: number;
    targetId?: string;
    targetType: 'role' | 'category' | 'channel' | 'channel-order' | 'role-order';
};

export type StructureObservedEventStateDocument = {
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    feature: 'import_export';
    guildId: string;
    updatedAt: string;
};

export type StructureBackupRecord = {
    categoryCount: number;
    channelCount: number;
    completedAt: string;
    createdAt: string;
    createdByUserId: string | null;
    errorMessage: string | null;
    guildId: string;
    id: string;
    name: string;
    roleCount: number;
    source: string;
    status: string;
    structure: Record<string, unknown> | null;
};

export type StructureBackupSummaryRecord = Omit<StructureBackupRecord, 'structure'>;

export type StructureBackupSettingsRecord = {
    cadenceWeeks: number;
    createdAt?: string;
    enabled: boolean;
    guildId: string;
    lastDriftBaselineBackupId: string | null;
    lastDriftBaselineName: string | null;
    lastDriftChangeCount: number | null;
    lastDriftCheckedAt: string | null;
    lastDriftErrorMessage: string | null;
    lastDriftFieldSummary: Record<string, unknown> | null;
    lastDriftHasMorePreview: boolean;
    lastDriftLiveCounts: Record<string, unknown> | null;
    lastDriftStatus: string | null;
    lastDriftSummary: Record<string, unknown> | null;
    lastAttemptAt: string | null;
    lastErrorMessage: string | null;
    lastSuccessAt: string | null;
    nextBackupAt: string | null;
    nextDriftCheckAt: string | null;
    nextRetentionPruneAt: string | null;
    retentionDays: number;
    updatedAt?: string;
};

export type StructureImportRunRecord = {
    createdAt: string;
    createdByUserId: string | null;
    guildId: string;
    deleteActionCount: number;
    deleteSetDigest: string | null;
    planDigest: string;
    planVersion: number;
    policy: 'merge' | 'synchronize' | 'rebuild';
    id: string;
    plan: Record<string, unknown>;
    requestedSnapshotDigest: string;
    sourceBackupId: string | null;
    status: 'building' | 'needs_mapping' | 'review_ready' | 'approved' | 'stale';
    updatedAt: string;
};

export type StructureImportActionRecord = {
    actionType: string;
    createdAt: string;
    details: Record<string, unknown>;
    id: string;
    runId: string;
    sequence: number;
    targetId: string | null;
    targetType: string;
};

export type StructureImportActionPageRecord = {
    actions: StructureImportActionRecord[];
    nextCursor: string | null;
};

export type StructureImportRunWithActionsRecord = StructureImportRunRecord & {
    actions: StructureImportActionRecord[];
};

export type StructureObservedEventStateRecord = {
    createdAt?: string;
    guildId: string;
    lastEventType?: string;
    lastObservedAt?: string;
    lastTargetId?: string;
    lastTargetType?: string;
    observedChangeCount: number;
    targetChangeCounts: Record<string, number>;
    updatedAt?: string;
};

export type StructureInputError =
    | { field: string; type: 'invalid-value' | 'missing-input' }
    | { from: string; to: string; type: 'invalid-status-transition' };
export type StructureInputResult<Value> = { ok: true; value: Value } | { error: StructureInputError; ok: false };
export type StructureBackupSettingsPatch = {
    backupLeaseExpiresAt?: string | undefined;
    backupLeaseId?: string | undefined;
    backupLeaseOwner?: string | undefined;
    backupLeaseStartedAt?: string | undefined;
    cadenceWeeks?: number;
    driftLeaseExpiresAt?: string | undefined;
    driftLeaseId?: string | undefined;
    driftLeaseOwner?: string | undefined;
    driftLeaseStartedAt?: string | undefined;
    enabled?: boolean;
    lastDriftBaselineBackupId?: string | undefined;
    lastDriftBaselineName?: string | undefined;
    lastDriftChangeCount?: number | undefined;
    lastDriftCheckedAt?: string | undefined;
    lastDriftErrorMessage?: string | undefined;
    lastDriftFieldSummary?: Record<string, unknown> | undefined;
    lastDriftHasMorePreview?: boolean | undefined;
    lastDriftLiveCounts?: Record<string, unknown> | undefined;
    lastDriftStatus?: string | undefined;
    lastDriftSummary?: Record<string, unknown> | undefined;
    lastAttemptAt?: string | undefined;
    lastErrorMessage?: string | undefined;
    lastSuccessAt?: string | undefined;
    nextBackupAt?: string | undefined;
    nextDriftCheckAt?: string | undefined;
    nextRetentionPruneAt?: string | undefined;
    retentionDays?: number;
    updatedAt: string;
};
export function buildStructureBackupDocument(
    input: StructureBackupInput,
    now: string
): StructureInputResult<StructureBackupDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);
    const completedAt = input.completedAt === undefined ? now : normalizeTimestamp(input.completedAt);
    const source = normalizeBackupSource(input.source);
    const status = normalizeBackupStatus(input.status);
    const structure = normalizeRecord(input.structure);

    if (!guildId.ok) return guildId;
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!completedAt) return { error: { field: 'completedAt', type: 'invalid-value' }, ok: false };
    if (!source) return { error: { field: 'source', type: 'invalid-value' }, ok: false };
    if (!status) return { error: { field: 'status', type: 'invalid-value' }, ok: false };
    if (status === STRUCTURE_BACKUP_STATUS.succeeded && !structure) {
        return { error: { field: 'structure', type: 'invalid-value' }, ok: false };
    }

    const createdByUserId = normalizeOptionalString(input.createdByUserId);
    const errorMessage = normalizeOptionalString(input.errorMessage);
    const name = normalizeBackupName(
        input.name,
        buildDefaultBackupName({
            completedAt,
            fallbackName: guildId.value,
            serverName: input.serverName,
            source,
        })
    );

    return {
        ok: true,
        value: {
            categoryCount: normalizeNonNegativeInteger(input.categoryCount),
            channelCount: normalizeNonNegativeInteger(input.channelCount),
            completedAt,
            createdAt,
            ...(createdByUserId ? { createdByUserId } : {}),
            ...(errorMessage ? { errorMessage } : {}),
            guildId: guildId.value,
            name,
            roleCount: normalizeNonNegativeInteger(input.roleCount),
            sortKey: normalizeBackupSortKey(input.sortKey, createdAt),
            source,
            status,
            ...(structure ? { structure } : {}),
        },
    };
}

export function buildStructureBackupSettingsDocument(
    input: StructureBackupSettingsInput,
    now: string
): StructureInputResult<StructureBackupSettingsDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    if (!guildId.ok) return guildId;

    const cadenceWeeks = normalizeCadenceWeeks(input.cadenceWeeks);
    const retentionDays = normalizeBackupRetentionDays(input.retentionDays);

    return {
        ok: true,
        value: {
            cadenceWeeks,
            createdAt: now,
            enabled: input.enabled === true,
            guildId: guildId.value,
            ...(input.enabled === true ? { nextBackupAt: addWeeks(now, cadenceWeeks) } : {}),
            ...(input.enabled === true ? { nextDriftCheckAt: now } : {}),
            nextRetentionPruneAt: now,
            retentionDays,
            updatedAt: now,
        },
    };
}

export function buildStructureBackupSettingsPatch(
    existing: StructureBackupSettingsDocument | undefined,
    input: StructureBackupSettingsInput,
    now: string
): StructureInputResult<StructureBackupSettingsPatch> {
    const cadenceWeeks = normalizeCadenceWeeks(input.cadenceWeeks ?? existing?.cadenceWeeks ?? 1);
    const enabled = input.enabled ?? existing?.enabled ?? false;
    const retentionDays = normalizeBackupRetentionDays(input.retentionDays ?? existing?.retentionDays);
    const cadenceChanged = input.cadenceWeeks !== undefined && input.cadenceWeeks !== existing?.cadenceWeeks;
    const enabledChanged = input.enabled !== undefined && input.enabled !== existing?.enabled;

    return {
        ok: true,
        value: {
            cadenceWeeks,
            enabled,
            nextBackupAt:
                enabled && (cadenceChanged || enabledChanged || !existing?.nextBackupAt)
                    ? addWeeks(now, cadenceWeeks)
                    : enabled
                      ? existing?.nextBackupAt
                      : undefined,
            nextDriftCheckAt:
                enabled && (enabledChanged || !existing?.nextDriftCheckAt)
                    ? now
                    : enabled
                      ? existing?.nextDriftCheckAt
                      : undefined,
            nextRetentionPruneAt: existing?.nextRetentionPruneAt ?? now,
            retentionDays,
            ...(enabled
                ? {}
                : {
                      driftLeaseExpiresAt: undefined,
                      driftLeaseId: undefined,
                      driftLeaseOwner: undefined,
                      driftLeaseStartedAt: undefined,
                  }),
            updatedAt: now,
        },
    };
}

export function buildStructureBackupLeaseClaimPatch(
    existing: StructureBackupSettingsDocument | undefined,
    input: {
        leaseExpiresAt?: string | null;
        leaseId?: string | null;
        leaseOwner?: string | null;
    },
    now: string
): StructureInputResult<StructureBackupSettingsPatch | null> {
    const leaseId = normalizeRequiredString(input.leaseId, 'leaseId');
    const leaseOwner = normalizeRequiredString(input.leaseOwner, 'leaseOwner');
    const leaseExpiresAt = normalizeTimestamp(input.leaseExpiresAt);
    const parsedNow = Date.parse(now);
    const parsedLeaseExpiresAt = Date.parse(leaseExpiresAt ?? '');

    if (!leaseId.ok) return leaseId;
    if (!leaseOwner.ok) return leaseOwner;
    if (!Number.isFinite(parsedNow)) return { error: { field: 'now', type: 'invalid-value' }, ok: false };
    if (!leaseExpiresAt || !Number.isFinite(parsedLeaseExpiresAt) || parsedLeaseExpiresAt <= parsedNow) {
        return { error: { field: 'leaseExpiresAt', type: 'invalid-value' }, ok: false };
    }
    if (!isBackupDueAndClaimable(existing, now)) return { ok: true, value: null };

    return {
        ok: true,
        value: {
            backupLeaseExpiresAt: leaseExpiresAt,
            backupLeaseId: leaseId.value,
            backupLeaseOwner: leaseOwner.value,
            backupLeaseStartedAt: now,
            updatedAt: now,
        },
    };
}

export function buildStructureBackupLeaseClearPatch(
    existing: StructureBackupSettingsDocument | undefined,
    input: { leaseId?: string | null },
    now: string
): StructureInputResult<StructureBackupSettingsPatch | null> {
    const leaseId = normalizeRequiredString(input.leaseId, 'leaseId');
    const parsedNow = Date.parse(now);

    if (!leaseId.ok) return leaseId;
    if (!Number.isFinite(parsedNow)) return { error: { field: 'now', type: 'invalid-value' }, ok: false };
    if (existing?.backupLeaseId !== leaseId.value) return { ok: true, value: null };

    return {
        ok: true,
        value: {
            backupLeaseExpiresAt: undefined,
            backupLeaseId: undefined,
            backupLeaseOwner: undefined,
            backupLeaseStartedAt: undefined,
            updatedAt: now,
        },
    };
}

export function buildStructureDriftLeaseClaimPatch(
    existing: StructureBackupSettingsDocument | undefined,
    input: {
        leaseExpiresAt?: string | null;
        leaseId?: string | null;
        leaseOwner?: string | null;
    },
    now: string
): StructureInputResult<StructureBackupSettingsPatch | null> {
    const leaseId = normalizeRequiredString(input.leaseId, 'leaseId');
    const leaseOwner = normalizeRequiredString(input.leaseOwner, 'leaseOwner');
    const leaseExpiresAt = normalizeTimestamp(input.leaseExpiresAt);
    const parsedNow = Date.parse(now);
    const parsedLeaseExpiresAt = Date.parse(leaseExpiresAt ?? '');

    if (!leaseId.ok) return leaseId;
    if (!leaseOwner.ok) return leaseOwner;
    if (!Number.isFinite(parsedNow)) return { error: { field: 'now', type: 'invalid-value' }, ok: false };
    if (!leaseExpiresAt || !Number.isFinite(parsedLeaseExpiresAt) || parsedLeaseExpiresAt <= parsedNow) {
        return { error: { field: 'leaseExpiresAt', type: 'invalid-value' }, ok: false };
    }
    if (!isDriftDueAndClaimable(existing, now)) return { ok: true, value: null };

    return {
        ok: true,
        value: {
            driftLeaseExpiresAt: leaseExpiresAt,
            driftLeaseId: leaseId.value,
            driftLeaseOwner: leaseOwner.value,
            driftLeaseStartedAt: now,
            nextDriftCheckAt: existing?.nextDriftCheckAt ?? now,
            updatedAt: now,
        },
    };
}

export function buildStructureDriftLeaseClearPatch(
    existing: StructureBackupSettingsDocument | undefined,
    input: { leaseId?: string | null },
    now: string
): StructureInputResult<StructureBackupSettingsPatch | null> {
    const leaseId = normalizeRequiredString(input.leaseId, 'leaseId');
    const parsedNow = Date.parse(now);

    if (!leaseId.ok) return leaseId;
    if (!Number.isFinite(parsedNow)) return { error: { field: 'now', type: 'invalid-value' }, ok: false };
    if (existing?.driftLeaseId !== leaseId.value) return { ok: true, value: null };

    return {
        ok: true,
        value: {
            driftLeaseExpiresAt: undefined,
            driftLeaseId: undefined,
            driftLeaseOwner: undefined,
            driftLeaseStartedAt: undefined,
            updatedAt: now,
        },
    };
}

export function buildStructureScheduledDriftResultPatch(
    existing: StructureBackupSettingsDocument | undefined,
    input: StructureScheduledDriftResultInput,
    now: string
): StructureInputResult<StructureBackupSettingsPatch> {
    const status = normalizeScheduledDriftStatus(input.status);
    const parsedNow = Date.parse(now);

    if (!status) return { error: { field: 'status', type: 'invalid-value' }, ok: false };
    if (!Number.isFinite(parsedNow)) return { error: { field: 'now', type: 'invalid-value' }, ok: false };

    const summary = normalizeRecord(input.summary);
    const fieldSummary = normalizeRecord(input.fieldSummary);
    const liveCounts = normalizeRecord(input.liveCounts);
    const baselineBackupId = normalizeOptionalString(input.baselineBackupId);
    const baselineName = normalizeDisplayText(input.baselineName);
    const errorMessage =
        status === STRUCTURE_SCHEDULED_DRIFT_STATUS.failed
            ? (normalizeOptionalString(input.errorMessage) ?? 'Scheduled drift check failed.')
            : status === STRUCTURE_SCHEDULED_DRIFT_STATUS.noBaseline
              ? (normalizeOptionalString(input.errorMessage) ?? 'No successful regular backup is available.')
              : undefined;

    return {
        ok: true,
        value: {
            driftLeaseExpiresAt: undefined,
            driftLeaseId: undefined,
            driftLeaseOwner: undefined,
            driftLeaseStartedAt: undefined,
            ...(baselineBackupId
                ? { lastDriftBaselineBackupId: baselineBackupId }
                : { lastDriftBaselineBackupId: undefined }),
            ...(baselineName ? { lastDriftBaselineName: baselineName } : { lastDriftBaselineName: undefined }),
            lastDriftChangeCount: normalizeNonNegativeInteger(input.changeCount),
            lastDriftCheckedAt: now,
            lastDriftErrorMessage: errorMessage,
            lastDriftFieldSummary: fieldSummary,
            lastDriftHasMorePreview: input.hasMorePreview === true,
            lastDriftLiveCounts: liveCounts,
            lastDriftStatus: status,
            lastDriftSummary: summary,
            nextDriftCheckAt: existing?.enabled ? addDays(now, STRUCTURE_DRIFT_CHECK_INTERVAL_DAYS) : undefined,
            updatedAt: now,
        },
    };
}

export function buildStructureBackupAttemptPatch(
    existing: StructureBackupSettingsDocument | undefined,
    input: { errorMessage?: string | null; status: string },
    now: string
): StructureBackupSettingsPatch {
    const cadenceWeeks = normalizeCadenceWeeks(existing?.cadenceWeeks ?? 1);
    const succeeded = input.status === STRUCTURE_BACKUP_STATUS.succeeded;
    const nextBackupAt = existing?.enabled ? addWeeks(now, cadenceWeeks) : undefined;
    const errorMessage = succeeded ? undefined : (normalizeOptionalString(input.errorMessage) ?? 'Backup failed.');

    return {
        cadenceWeeks,
        enabled: existing?.enabled ?? false,
        lastAttemptAt: now,
        lastErrorMessage: errorMessage,
        ...(succeeded ? { lastSuccessAt: now } : {}),
        nextBackupAt,
        nextRetentionPruneAt: existing?.nextRetentionPruneAt ?? now,
        retentionDays: normalizeBackupRetentionDays(existing?.retentionDays),
        updatedAt: now,
    };
}

export function buildStructureImportRunDocument(
    input: StructureImportRunInput,
    now: string
): StructureInputResult<StructureImportRunDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const deleteActionCount = input.deleteActionCount;
    const deleteSetDigest = normalizeOptionalString(input.deleteSetDigest);
    const planDigest = normalizeRequiredString(input.planDigest, 'planDigest');
    const requestedSnapshotDigest = normalizeRequiredString(input.requestedSnapshotDigest, 'requestedSnapshotDigest');
    const policy = normalizeImportPolicy(input.policy);
    const status = normalizeImportRunStatus(input.status);
    const plan = normalizeRecord(input.plan ?? {});
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) return guildId;
    if (typeof deleteActionCount !== 'number' || !Number.isInteger(deleteActionCount) || deleteActionCount < 0)
        return { error: { field: 'deleteActionCount', type: 'invalid-value' }, ok: false };
    if (deleteActionCount > 0 && !deleteSetDigest)
        return { error: { field: 'deleteSetDigest', type: 'missing-input' }, ok: false };
    if (deleteActionCount === 0 && deleteSetDigest)
        return { error: { field: 'deleteSetDigest', type: 'invalid-value' }, ok: false };
    if (!planDigest.ok) return planDigest;
    if (!requestedSnapshotDigest.ok) return requestedSnapshotDigest;
    if (!policy) return { error: { field: 'policy', type: 'invalid-value' }, ok: false };
    if (!status) return { error: { field: 'status', type: 'invalid-value' }, ok: false };
    if (input.planVersion !== 3) return { error: { field: 'planVersion', type: 'invalid-value' }, ok: false };
    if (!plan) return { error: { field: 'plan', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    const createdByUserId = normalizeOptionalString(input.createdByUserId);
    const sourceBackupId = normalizeOptionalString(input.sourceBackupId);

    return {
        ok: true,
        value: {
            createdAt,
            ...(createdByUserId ? { createdByUserId } : {}),
            guildId: guildId.value,
            deleteActionCount,
            ...(deleteSetDigest ? { deleteSetDigest } : {}),
            planDigest: planDigest.value,
            planVersion: 3,
            policy,
            plan,
            requestedSnapshotDigest: requestedSnapshotDigest.value,
            ...(sourceBackupId ? { sourceBackupId: sourceBackupId as GenericId<'structureBackups'> } : {}),
            status,
            updatedAt,
        },
    };
}

export function buildStructureImportActionDocument(
    input: StructureImportActionInput,
    now: string
): StructureInputResult<StructureImportActionDocument> {
    const runId = normalizeRequiredString(input.runId, 'runId');
    const actionType = normalizeRequiredString(input.actionType, 'actionType');
    const targetType = normalizeRequiredString(input.targetType, 'targetType');
    const details = normalizeRecord(input.details ?? {});
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);

    if (!runId.ok) return runId;
    if (!actionType.ok) return actionType;
    if (!targetType.ok) return targetType;
    if (!details) return { error: { field: 'details', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };

    const sequence = normalizeRequiredNonNegativeInteger(input.sequence);
    const targetId = normalizeOptionalString(input.targetId);
    const normalizedActionType = normalizeImportActionType(actionType.value);
    const normalizedTargetType = normalizeImportTargetType(targetType.value);

    if (sequence === undefined) return { error: { field: 'sequence', type: 'invalid-value' }, ok: false };
    if (!normalizedActionType) return { error: { field: 'actionType', type: 'invalid-value' }, ok: false };
    if (!normalizedTargetType) return { error: { field: 'targetType', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            actionType: normalizedActionType,
            createdAt,
            details,
            runId: runId.value as GenericId<'structureImportRuns'>,
            sequence,
            ...(targetId ? { targetId } : {}),
            targetType: normalizedTargetType,
        },
    };
}

export function buildObservedEventStateDocument(
    input: { eventType?: string | null; guildId?: string | null; targetId?: string | null; targetType?: string | null },
    existing: StructureObservedEventStateRecord,
    now: string,
    existingDocument?: Pick<StructureObservedEventStateDocument, 'createdAt'>
): StructureInputResult<StructureObservedEventStateDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const eventType = normalizeRequiredString(input.eventType, 'eventType');
    const targetType = normalizeRequiredString(input.targetType, 'targetType');

    if (!guildId.ok) return guildId;
    if (!eventType.ok) return eventType;
    if (!targetType.ok) return targetType;

    const targetId = normalizeOptionalString(input.targetId);
    const targetChangeCounts = {
        ...existing.targetChangeCounts,
        [targetType.value]: (existing.targetChangeCounts[targetType.value] ?? 0) + 1,
    };
    const config = {
        lastEventType: eventType.value,
        lastObservedAt: now,
        ...(targetId ? { lastTargetId: targetId } : {}),
        lastTargetType: targetType.value,
        observedChangeCount: existing.observedChangeCount + 1,
        targetChangeCounts,
    };

    return {
        ok: true,
        value: {
            config,
            createdAt: existingDocument?.createdAt ?? now,
            enabled: true,
            feature: 'import_export',
            guildId: guildId.value,
            updatedAt: now,
        },
    };
}

export function toStructureBackupRecord(document: StructureBackupDocument & { _id: string }): StructureBackupRecord {
    const name = normalizeBackupName(
        (document as StructureBackupDocument & { name?: string }).name,
        buildDefaultBackupName({
            completedAt: document.completedAt,
            fallbackName: document.guildId,
            source: document.source,
        })
    );

    return {
        categoryCount: document.categoryCount,
        channelCount: document.channelCount,
        completedAt: document.completedAt,
        createdAt: document.createdAt,
        createdByUserId: document.createdByUserId ?? null,
        errorMessage: document.errorMessage ?? null,
        guildId: document.guildId,
        id: document._id,
        name,
        roleCount: document.roleCount,
        source: document.source,
        status: document.status,
        structure: document.structure ?? null,
    };
}

export function toStructureBackupSummaryRecord(
    document: StructureBackupDocument & { _id: string }
): StructureBackupSummaryRecord {
    const name = normalizeBackupName(
        (document as StructureBackupDocument & { name?: string }).name,
        buildDefaultBackupName({
            completedAt: document.completedAt,
            fallbackName: document.guildId,
            source: document.source,
        })
    );

    return {
        categoryCount: document.categoryCount,
        channelCount: document.channelCount,
        completedAt: document.completedAt,
        createdAt: document.createdAt,
        createdByUserId: document.createdByUserId ?? null,
        errorMessage: document.errorMessage ?? null,
        guildId: document.guildId,
        id: document._id,
        name,
        roleCount: document.roleCount,
        source: document.source,
        status: document.status,
    };
}

export function toStructureBackupSettingsRecord(
    document: StructureBackupSettingsDocument | undefined,
    guildId: string
): StructureBackupSettingsRecord {
    return {
        cadenceWeeks: normalizeCadenceWeeks(document?.cadenceWeeks ?? 1),
        ...(document?.createdAt ? { createdAt: document.createdAt } : {}),
        enabled: document?.enabled ?? false,
        guildId,
        lastDriftBaselineBackupId: document?.lastDriftBaselineBackupId ?? null,
        lastDriftBaselineName: document?.lastDriftBaselineName ?? null,
        lastDriftChangeCount: readNonNegativeIntegerOrNull(document?.lastDriftChangeCount),
        lastDriftCheckedAt: document?.lastDriftCheckedAt ?? null,
        lastDriftErrorMessage: document?.lastDriftErrorMessage ?? null,
        lastDriftFieldSummary: normalizeRecord(document?.lastDriftFieldSummary) ?? null,
        lastDriftHasMorePreview: document?.lastDriftHasMorePreview === true,
        lastDriftLiveCounts: normalizeRecord(document?.lastDriftLiveCounts) ?? null,
        lastDriftStatus: document?.lastDriftStatus ?? null,
        lastDriftSummary: normalizeRecord(document?.lastDriftSummary) ?? null,
        lastAttemptAt: document?.lastAttemptAt ?? null,
        lastErrorMessage: document?.lastErrorMessage ?? null,
        lastSuccessAt: document?.lastSuccessAt ?? null,
        nextBackupAt: document?.nextBackupAt ?? null,
        nextDriftCheckAt: document?.nextDriftCheckAt ?? null,
        nextRetentionPruneAt: document?.nextRetentionPruneAt ?? null,
        retentionDays: normalizeBackupRetentionDays(document?.retentionDays),
        ...(document?.updatedAt ? { updatedAt: document.updatedAt } : {}),
    };
}

export function toStructureImportRunRecord(
    document: StructureImportRunDocument & { _id: string }
): StructureImportRunRecord {
    return {
        createdAt: document.createdAt,
        createdByUserId: document.createdByUserId ?? null,
        guildId: document.guildId,
        deleteActionCount: document.deleteActionCount,
        deleteSetDigest: document.deleteSetDigest ?? null,
        planDigest: document.planDigest,
        planVersion: document.planVersion,
        policy: document.policy,
        id: document._id,
        plan: document.plan,
        requestedSnapshotDigest: document.requestedSnapshotDigest,
        sourceBackupId: document.sourceBackupId ?? null,
        status: document.status,
        updatedAt: document.updatedAt,
    };
}

export function toStructureImportActionRecord(
    document: StructureImportActionDocument & { _id: string }
): StructureImportActionRecord {
    return {
        actionType: document.actionType,
        createdAt: document.createdAt,
        details: document.details,
        id: document._id,
        runId: document.runId,
        sequence: document.sequence,
        targetId: document.targetId ?? null,
        targetType: document.targetType,
    };
}

export function toStructureObservedEventStateRecord(input: {
    config?: unknown;
    createdAt?: string;
    guildId: string;
    updatedAt?: string;
}): StructureObservedEventStateRecord {
    const config = normalizeRecord(input.config) ?? {};
    const lastEventType = readStringField(config, 'lastEventType');
    const lastObservedAt = readTimestampField(config, 'lastObservedAt');
    const lastTargetId = readStringField(config, 'lastTargetId');
    const lastTargetType = readStringField(config, 'lastTargetType');

    return {
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        guildId: input.guildId,
        ...(lastEventType ? { lastEventType } : {}),
        ...(lastObservedAt ? { lastObservedAt } : {}),
        ...(lastTargetId ? { lastTargetId } : {}),
        ...(lastTargetType ? { lastTargetType } : {}),
        observedChangeCount: readNonNegativeInteger(config.observedChangeCount),
        targetChangeCounts: readTargetChangeCounts(config.targetChangeCounts),
        ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    };
}

export function normalizeRequiredGuildId(value: string): StructureInputResult<string> {
    return normalizeRequiredString(value, 'guildId');
}

export function normalizeLimit(limit: number | undefined, fallback = 20): number {
    if (limit === undefined || !Number.isFinite(limit)) return fallback;
    return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

export function normalizeCadenceWeeks(value: number | null | undefined): number {
    if (value === undefined || value === null || !Number.isFinite(value)) return 1;
    return Math.max(1, Math.trunc(value));
}

export function normalizeBackupRetentionDays(value: number | null | undefined): number {
    if (value === undefined || value === null || !Number.isFinite(value))
        return STRUCTURE_BACKUP_RETENTION_DAYS_DEFAULT;
    return Math.min(Math.max(Math.trunc(value), 1), STRUCTURE_BACKUP_RETENTION_DAYS_MAX);
}

export function normalizeBackupName(value: string | null | undefined, fallback: string): string {
    const normalizedValue = normalizeDisplayText(value);
    const normalizedFallback = normalizeDisplayText(fallback) ?? 'Server backup';
    return (normalizedValue ?? normalizedFallback).slice(0, STRUCTURE_BACKUP_NAME_MAX_LENGTH);
}

export function buildDefaultBackupName(input: {
    completedAt: string;
    fallbackName: string;
    serverName?: string | null | undefined;
    source?: string | null | undefined;
}): string {
    const parsed = Date.parse(input.completedAt);
    const timestamp = Number.isFinite(parsed) ? new Date(parsed) : new Date();
    const iso = timestamp.toISOString();
    const date = iso.slice(0, 10);
    const time = iso.slice(11, 16).replace(':', '-');
    const displayName = normalizeDisplayText(input.serverName) ?? normalizeDisplayText(input.fallbackName) ?? 'Server';

    const sourceLabel = input.source === STRUCTURE_BACKUP_SOURCE.restorePoint ? ' - restore point' : '';

    return normalizeBackupName(`${displayName}${sourceLabel} - ${date} - ${time}`, 'Server backup');
}

export function buildBackupSortCursor(input: { createdAt: string; id: string }): string {
    return `${input.createdAt}|${input.id}`;
}

export function isStructureBackupRetentionEligible(
    backup: { createdAt: string; id: string; source: string },
    input: { protectedRestorePointIds: ReadonlySet<string>; restorePointCutoff: string }
): boolean {
    if (input.protectedRestorePointIds.has(backup.id)) return false;
    return backup.source !== STRUCTURE_BACKUP_SOURCE.restorePoint || backup.createdAt < input.restorePointCutoff;
}

export function classifyStructureImportExecutionReclaim(input: {
    hasStartedAttempt: boolean;
    leaseExpiresAt?: string;
    now: string;
}): 'active' | 'outcome_unknown' | 'reclaim' {
    if (!input.leaseExpiresAt || input.leaseExpiresAt > input.now) return 'active';
    return input.hasStartedAttempt ? 'outcome_unknown' : 'reclaim';
}

export function classifyStructureExecutionPreMutationAuthorization(input: {
    completedMutationSteps: number;
    expectedLiveFingerprint: string;
    expiresAt: string;
    liveFingerprint?: string;
    nextActionSequence: number;
    now: string;
}) {
    if (input.nextActionSequence > 0 || input.completedMutationSteps > 0) return 'not_required' as const;
    if (input.expiresAt <= input.now) return 'preflight_expired' as const;
    if (input.liveFingerprint === undefined) return 'authorization_required' as const;
    return input.liveFingerprint === input.expectedLiveFingerprint
        ? ('authorized' as const)
        : ('live_fingerprint_stale' as const);
}

export function resolveStructureExecutionMutationAuthorization(input: {
    completedMutationSteps: number;
    expectedLiveFingerprint: string;
    expiresAt: string;
    leaseId: string;
    liveFingerprint: string;
    nextActionSequence: number;
    now: string;
    structure: unknown;
}):
    | { type: 'not_required' | 'preflight_expired' | 'live_fingerprint_stale' }
    | {
          type: 'authorized';
          executionPatch: {
              mutationAuthorizedAt: string;
              mutationAuthorizationLeaseId: string;
              updatedAt: string;
          };
          restorePointPatch: {
              categoryCount: number;
              channelCount: number;
              completedAt: string;
              roleCount: number;
              structure: Record<string, unknown>;
          };
      }
    | { type: 'invalid_snapshot' } {
    const authorization = classifyStructureExecutionPreMutationAuthorization(input);
    if (authorization === 'authorization_required') return { type: 'invalid_snapshot' };
    if (authorization !== 'authorized') return { type: authorization };
    const structure = normalizeRecord(input.structure);
    if (
        !structure ||
        !Array.isArray(structure.roles) ||
        !Array.isArray(structure.categories) ||
        !Array.isArray(structure.channels)
    ) {
        return { type: 'invalid_snapshot' };
    }
    return {
        type: 'authorized',
        executionPatch: {
            mutationAuthorizedAt: input.now,
            mutationAuthorizationLeaseId: input.leaseId,
            updatedAt: input.now,
        },
        restorePointPatch: {
            categoryCount: structure.categories.length,
            channelCount: structure.channels.length,
            completedAt: input.now,
            roleCount: structure.roles.length,
            structure,
        },
    };
}

export function isStructureExecutionMutationAuthorizedForLease(input: {
    completedMutationSteps: number;
    expiresAt: string;
    leaseId: string;
    mutationAuthorizedAt?: string;
    mutationAuthorizationLeaseId?: string;
    nextActionSequence: number;
    now: string;
}): boolean {
    if (input.nextActionSequence > 0 || input.completedMutationSteps > 0) return true;
    return (
        input.expiresAt > input.now &&
        Boolean(input.mutationAuthorizedAt) &&
        input.mutationAuthorizationLeaseId === input.leaseId
    );
}

export function isStructureImportRetryPreflightFresh(input: {
    latestExecution?: { status: string; updatedAt: string } | null;
    preflightCheckedAt: string;
}): boolean {
    return (
        input.latestExecution?.status !== 'failed_before_mutation' ||
        input.preflightCheckedAt > input.latestExecution.updatedAt
    );
}

export function resolveExpiredStructureImportControl(controlRequest: unknown): 'paused' | 'cancelled' {
    return controlRequest === 'cancel' ? 'cancelled' : 'paused';
}

export function resolveStructureAttemptCompletionStatus(input: {
    controlRequest: unknown;
    executionStatus: string;
    requestedStatus:
        | 'running'
        | 'pause_requested'
        | 'waiting_rate_limit'
        | 'partially_applied'
        | 'failed_before_mutation'
        | 'outcome_unknown';
}):
    | 'running'
    | 'pause_requested'
    | 'waiting_rate_limit'
    | 'partially_applied'
    | 'failed_before_mutation'
    | 'outcome_unknown'
    | 'paused'
    | 'cancelled' {
    const requestedTerminal =
        input.requestedStatus === 'partially_applied' ||
        input.requestedStatus === 'failed_before_mutation' ||
        input.requestedStatus === 'outcome_unknown';
    if (requestedTerminal || input.executionStatus !== 'pause_requested') return input.requestedStatus;
    return input.controlRequest === 'cancel' ? 'cancelled' : 'paused';
}

export function validateStructureImportDecisionSequences(
    sequences: readonly number[],
    existingSequences: readonly number[] = [],
    expectedStart?: number
): 'empty' | 'invalid' | 'duplicate' | 'sparse' | 'collision' | 'gap' | null {
    if (sequences.length === 0) return 'empty';
    if (sequences.some((sequence) => !Number.isInteger(sequence) || sequence < 0)) return 'invalid';
    if (new Set(sequences).size !== sequences.length) return 'duplicate';
    const min = Math.min(...sequences);
    const max = Math.max(...sequences);
    if (max - min + 1 !== sequences.length || sequences.some((sequence, index) => sequence !== min + index))
        return 'sparse';
    if (expectedStart !== undefined && min !== expectedStart) return 'gap';
    const requested = new Set(sequences);
    return existingSequences.some((sequence) => requested.has(sequence)) ? 'collision' : null;
}

export function isStructureImportDecisionLedgerComplete(
    plan: unknown,
    decisions: Array<{ classification: string; sequence: number }>
): boolean {
    if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) return false;
    const decisionSummary = (plan as Record<string, unknown>).decisionSummary;
    if (typeof decisionSummary !== 'object' || decisionSummary === null || Array.isArray(decisionSummary)) return false;
    const expectedEntries = Object.entries(decisionSummary);
    if (expectedEntries.some(([, count]) => !Number.isInteger(count) || (count as number) < 0)) return false;
    const expectedCount = expectedEntries.reduce((total, [, count]) => total + (count as number), 0);
    if (decisions.length !== expectedCount || decisions.some((decision, index) => decision.sequence !== index)) {
        return false;
    }
    const actual = new Map<string, number>();
    for (const decision of decisions)
        actual.set(decision.classification, (actual.get(decision.classification) ?? 0) + 1);
    return expectedEntries.every(([classification, count]) => (actual.get(classification) ?? 0) === count);
}

export function chooseLatestStructureDriftBaselineBackup<TBackup extends StructureBackupDocument>(
    backups: readonly TBackup[]
): TBackup | undefined {
    return [...backups]
        .filter(
            (backup) =>
                Boolean(backup.structure) &&
                backup.status === STRUCTURE_BACKUP_STATUS.succeeded &&
                (backup.source === STRUCTURE_BACKUP_SOURCE.manual ||
                    backup.source === STRUCTURE_BACKUP_SOURCE.scheduled)
        )
        .sort((left, right) => right.sortKey.localeCompare(left.sortKey))
        .at(0);
}

export function addWeeks(value: string, weeks: number): string {
    const parsed = Date.parse(value);
    const start = Number.isFinite(parsed) ? parsed : Date.now();
    return new Date(start + normalizeCadenceWeeks(weeks) * 7 * 24 * 60 * 60 * 1000).toISOString();
}

export function addDays(value: string, days: number): string {
    const parsed = Date.parse(value);
    const start = Number.isFinite(parsed) ? parsed : Date.now();
    return new Date(start + Math.max(1, Math.trunc(days)) * 24 * 60 * 60 * 1000).toISOString();
}

function isBackupDueAndClaimable(existing: StructureBackupSettingsDocument | undefined, now: string): boolean {
    if (!existing?.enabled || !existing.nextBackupAt) return false;

    const parsedNow = Date.parse(now);
    const parsedNextBackupAt = Date.parse(existing.nextBackupAt);
    const parsedLeaseExpiresAt = Date.parse(existing.backupLeaseExpiresAt ?? '');

    if (!Number.isFinite(parsedNow) || !Number.isFinite(parsedNextBackupAt) || parsedNextBackupAt > parsedNow) {
        return false;
    }

    return !Number.isFinite(parsedLeaseExpiresAt) || parsedLeaseExpiresAt <= parsedNow;
}

function isDriftDueAndClaimable(existing: StructureBackupSettingsDocument | undefined, now: string): boolean {
    if (!existing?.enabled) return false;

    const parsedNow = Date.parse(now);
    const parsedNextDriftCheckAt = Date.parse(existing.nextDriftCheckAt ?? now);
    const parsedLeaseExpiresAt = Date.parse(existing.driftLeaseExpiresAt ?? '');

    if (!Number.isFinite(parsedNow) || !Number.isFinite(parsedNextDriftCheckAt) || parsedNextDriftCheckAt > parsedNow) {
        return false;
    }

    return !Number.isFinite(parsedLeaseExpiresAt) || parsedLeaseExpiresAt <= parsedNow;
}

function normalizeBackupSource(value: string | null | undefined): string | undefined {
    const source = normalizeOptionalString(value) ?? STRUCTURE_BACKUP_SOURCE.manual;
    return source === STRUCTURE_BACKUP_SOURCE.manual ||
        source === STRUCTURE_BACKUP_SOURCE.scheduled ||
        source === STRUCTURE_BACKUP_SOURCE.restorePoint
        ? source
        : undefined;
}

function normalizeBackupSortKey(value: string | null | undefined, createdAt: string): string {
    const normalized = normalizeDisplayText(value);
    return normalized ?? buildBackupSortCursor({ createdAt, id: '00000000-0000-4000-8000-000000000000' });
}

function normalizeBackupStatus(value: string | null | undefined): string | undefined {
    const status = normalizeOptionalString(value) ?? STRUCTURE_BACKUP_STATUS.succeeded;
    return status === STRUCTURE_BACKUP_STATUS.succeeded || status === STRUCTURE_BACKUP_STATUS.failed
        ? status
        : undefined;
}

function normalizeScheduledDriftStatus(value: string | null | undefined): string | undefined {
    const status = normalizeOptionalString(value);
    return status === STRUCTURE_SCHEDULED_DRIFT_STATUS.clean ||
        status === STRUCTURE_SCHEDULED_DRIFT_STATUS.changed ||
        status === STRUCTURE_SCHEDULED_DRIFT_STATUS.failed ||
        status === STRUCTURE_SCHEDULED_DRIFT_STATUS.noBaseline
        ? status
        : undefined;
}

function normalizeImportPolicy(value: string | null | undefined): 'merge' | 'synchronize' | 'rebuild' | undefined {
    const policy = normalizeOptionalString(value);
    return policy === 'merge' || policy === 'synchronize' || policy === 'rebuild' ? policy : undefined;
}

function normalizeImportRunStatus(value: string | null | undefined): StructureImportRunDocument['status'] | undefined {
    const status = normalizeOptionalString(value) ?? STRUCTURE_IMPORT_RUN_STATUS.building;
    return status === 'building' ||
        status === 'needs_mapping' ||
        status === 'review_ready' ||
        status === 'approved' ||
        status === 'stale'
        ? status
        : undefined;
}

function normalizeImportActionType(value: string): StructureImportActionDocument['actionType'] | undefined {
    return value === 'create' || value === 'update' || value === 'delete' ? value : undefined;
}

function normalizeImportTargetType(value: string): StructureImportActionDocument['targetType'] | undefined {
    return value === 'role' ||
        value === 'category' ||
        value === 'channel' ||
        value === 'channel-order' ||
        value === 'role-order'
        ? value
        : undefined;
}

function normalizeRequiredString(value: string | null | undefined, field: string): StructureInputResult<string> {
    const normalizedValue = normalizeOptionalString(value);
    return normalizedValue
        ? { ok: true, value: normalizedValue }
        : { error: { field, type: 'missing-input' }, ok: false };
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();
    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeDisplayText(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.replace(/\s+/g, ' ').trim();
    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function normalizeNonNegativeInteger(value: number | null | undefined): number {
    return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : 0;
}

function normalizeRequiredNonNegativeInteger(value: number | null | undefined): number | undefined {
    return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : undefined;
}

function readNonNegativeInteger(value: unknown): number {
    return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : 0;
}

function readNonNegativeIntegerOrNull(value: unknown): number | null {
    return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : null;
}

function readStringField(config: Record<string, unknown>, field: string): string | undefined {
    const value = config[field];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readTimestampField(config: Record<string, unknown>, field: string): string | undefined {
    const value = config[field];
    return typeof value === 'string' ? normalizeTimestamp(value) : undefined;
}

function readTargetChangeCounts(value: unknown): Record<string, number> {
    const record = normalizeRecord(value);
    if (!record) return {};

    return Object.fromEntries(
        Object.entries(record)
            .map(([key, count]) => [key, readNonNegativeInteger(count)] as const)
            .filter(([, count]) => count > 0)
    );
}

export function resolveStructureExecutionReferenceAuthority(plan: unknown): {
    idMap: Record<string, string>;
    knownTargetKinds: Record<string, 'role' | 'category' | 'channel'>;
} {
    const planRecord = normalizeRecord(plan);
    const sourceTargetMap = normalizeRecord(planRecord?.sourceTargetMap);
    const knownTargetKinds = normalizeRecord(planRecord?.knownTargetKinds);
    if (!sourceTargetMap) throw new Error('structure-plan-source-target-map-invalid');
    if (!knownTargetKinds) throw new Error('structure-plan-known-target-kinds-invalid');

    const resolved: Record<string, string> = {};
    const resolvedTargetIds = new Set<string>();
    for (const [sourceIdValue, targetIdValue] of Object.entries(sourceTargetMap)) {
        const sourceId = sourceIdValue.trim();
        if (!sourceId || sourceId !== sourceIdValue) {
            throw new Error('structure-plan-source-target-map-invalid');
        }
        if (targetIdValue === null) continue;
        if (typeof targetIdValue !== 'string' || !targetIdValue.trim() || targetIdValue !== targetIdValue.trim()) {
            throw new Error('structure-plan-source-target-map-invalid');
        }
        if (resolvedTargetIds.has(targetIdValue)) throw new Error('structure-plan-source-target-map-invalid');
        resolved[sourceId] = targetIdValue;
        resolvedTargetIds.add(targetIdValue);
    }

    const knownTargetIdSet = new Set(Object.keys(knownTargetKinds));
    if (Object.values(resolved).some((targetId) => !knownTargetIdSet.has(targetId))) {
        throw new Error('structure-plan-source-target-map-invalid');
    }

    const normalizedTargetKinds: Record<string, 'role' | 'category' | 'channel'> = {};
    for (const [id, kind] of Object.entries(knownTargetKinds)) {
        if (!id.trim() || id !== id.trim() || (kind !== 'role' && kind !== 'category' && kind !== 'channel')) {
            throw new Error('structure-plan-known-target-kinds-invalid');
        }
        normalizedTargetKinds[id] = kind;
    }
    const targetIds = Object.keys(normalizedTargetKinds);
    if (
        !targetIds.every((id, index) => [...targetIds].sort((left, right) => left.localeCompare(right))[index] === id)
    ) {
        throw new Error('structure-plan-known-target-kinds-invalid');
    }

    return {
        idMap: resolved,
        knownTargetKinds: normalizedTargetKinds,
    };
}

export function resolveStructureExecutionIdMap(plan: unknown): Record<string, string> {
    return resolveStructureExecutionReferenceAuthority(plan).idMap;
}

export function validateStructureExecutionIdMapTransition(input: {
    next: unknown;
    plan: unknown;
    previous: unknown;
}): Record<string, string> {
    const sourceTargetMap = normalizeRecord(normalizeRecord(input.plan)?.sourceTargetMap);
    const previous = normalizeStructureExecutionIdMap(input.previous);
    const next = normalizeStructureExecutionIdMap(input.next);
    const initial = resolveStructureExecutionIdMap(input.plan);
    if (!sourceTargetMap) throw new Error('structure-plan-source-target-map-invalid');

    for (const sourceId of Object.keys(initial)) {
        if (!Object.hasOwn(previous, sourceId) || !Object.hasOwn(next, sourceId)) {
            throw new Error('structure-execution-id-map-conflict');
        }
    }
    validateStructureExecutionIdMapEntries(previous, sourceTargetMap);
    for (const [sourceId, targetId] of Object.entries(previous)) {
        if (next[sourceId] !== targetId) throw new Error('structure-execution-id-map-regression');
    }
    validateStructureExecutionIdMapEntries(next, sourceTargetMap);

    return next;
}

function validateStructureExecutionIdMapEntries(
    idMap: Record<string, string>,
    sourceTargetMap: Record<string, unknown>
): void {
    const targetIds = new Set<string>();
    for (const [sourceId, targetId] of Object.entries(idMap)) {
        if (!Object.hasOwn(sourceTargetMap, sourceId)) throw new Error('structure-execution-id-map-unknown-source');
        if (targetIds.has(targetId)) throw new Error('structure-execution-id-map-conflict');
        targetIds.add(targetId);
    }
}

export function validateStructureExecutionCheckpointIdMap(input: {
    next: unknown;
    plan: unknown;
    previous: unknown;
}): Record<string, string> {
    const previous = normalizeStructureExecutionIdMap(input.previous);
    const next = validateStructureExecutionIdMapTransition(input);
    if (stableJson(previous) !== stableJson(next)) throw new Error('structure-execution-id-map-checkpoint-change');
    return next;
}

export function validateStructureExecutionAttemptIdMapTransition(input: {
    action: { actionType: string; targetId?: string };
    attemptState: string;
    createdId?: string;
    next: unknown;
    plan: unknown;
    previous: unknown;
    resultState: 'applied' | 'failed' | 'unknown';
}): Record<string, string> {
    const previous = normalizeStructureExecutionIdMap(input.previous);
    validateStructureExecutionIdMapTransition({ ...input, next: previous, previous });
    const next = normalizeStructureExecutionIdMap(input.next);
    if (
        input.attemptState === 'started' &&
        input.resultState === 'applied' &&
        input.action.actionType === 'create' &&
        typeof input.action.targetId === 'string' &&
        input.action.targetId.length > 0 &&
        typeof input.createdId === 'string' &&
        input.createdId.length > 0
    ) {
        const sourceTargetMap = normalizeRecord(normalizeRecord(input.plan)?.sourceTargetMap);
        const knownTargetKinds = resolveStructureExecutionReferenceAuthority(input.plan).knownTargetKinds;
        const changedSources = new Set([...Object.keys(previous), ...Object.keys(next)]);
        for (const sourceId of [...changedSources]) {
            if (previous[sourceId] === next[sourceId]) changedSources.delete(sourceId);
        }
        const targetIds = Object.values(next);
        if (
            !sourceTargetMap ||
            !Object.hasOwn(sourceTargetMap, input.action.targetId) ||
            changedSources.size !== 1 ||
            !changedSources.has(input.action.targetId) ||
            next[input.action.targetId] !== input.createdId ||
            previous[input.action.targetId] === input.createdId ||
            Object.hasOwn(knownTargetKinds, input.createdId) ||
            new Set(targetIds).size !== targetIds.length
        ) {
            throw new Error('structure-execution-create-id-map-invalid');
        }
        return next;
    }
    validateStructureExecutionIdMapTransition({ ...input, next, previous });
    if (input.createdId !== undefined || stableJson(previous) !== stableJson(next)) {
        throw new Error('structure-execution-id-map-attempt-change');
    }
    return next;
}

export function validateStructureExecutionProgressTransition(input: {
    next: {
        appliedActions: number;
        completedMutationSteps: number;
        failedActions: number;
        nextActionSequence: number;
        notStartedActions: number;
        skippedActions: number;
        totalMutationSteps: number;
    };
    previous: {
        appliedActions: number;
        completedMutationSteps: number;
        failedActions: number;
        nextActionSequence: number;
        skippedActions: number;
        totalActions: number;
        totalMutationSteps: number;
    };
}): void {
    const { next, previous } = input;
    if (
        [
            next.appliedActions,
            next.completedMutationSteps,
            next.failedActions,
            next.nextActionSequence,
            next.notStartedActions,
            next.skippedActions,
            next.totalMutationSteps,
        ].some((value) => !Number.isInteger(value) || value < 0) ||
        next.nextActionSequence > previous.totalActions ||
        next.completedMutationSteps > next.totalMutationSteps ||
        next.totalMutationSteps !== previous.totalMutationSteps ||
        previous.totalMutationSteps !== previous.totalActions ||
        next.completedMutationSteps !== next.appliedActions ||
        next.appliedActions + next.failedActions + next.skippedActions !== next.nextActionSequence ||
        next.notStartedActions !== previous.totalActions - next.nextActionSequence
    ) {
        throw new Error('structure-execution-progress-invalid');
    }
    if (
        next.appliedActions < previous.appliedActions ||
        next.completedMutationSteps < previous.completedMutationSteps ||
        next.failedActions < previous.failedActions ||
        next.nextActionSequence < previous.nextActionSequence ||
        next.skippedActions < previous.skippedActions
    ) {
        throw new Error('structure-execution-progress-regression');
    }
}

export function validateStructureExecutionActionLedger(
    plan: unknown,
    actions: ReadonlyArray<{
        actionType: string;
        details: unknown;
        sequence: number;
        targetId?: string;
        targetType: string;
    }>
): { deleteActionCount: number; deleteSetKeys: string[] } {
    const planRecord = normalizeRecord(plan);
    const fingerprintInput = normalizeRecord(planRecord?.fingerprintInput);
    const reviewedActions = planRecord?.executionActions;
    const fingerprintActions = fingerprintInput?.executionActions;
    if (!Array.isArray(reviewedActions) || !Array.isArray(fingerprintActions)) {
        throw new Error('structure-execution-action-ledger-invalid');
    }
    if (stableJson(reviewedActions) !== stableJson(fingerprintActions) || reviewedActions.length !== actions.length) {
        throw new Error('structure-execution-action-ledger-invalid');
    }
    const deleteSetKeys: string[] = [];
    for (const [sequence, reviewedValue] of reviewedActions.entries()) {
        const reviewed = normalizeRecord(reviewedValue);
        const action = actions[sequence];
        const reviewedDetails = normalizeRecord(reviewed?.details);
        const execution = normalizeRecord(reviewedDetails?.execution);
        if (
            !reviewed ||
            !reviewedDetails ||
            !execution ||
            action?.sequence !== sequence ||
            (reviewed.actionType !== 'create' &&
                reviewed.actionType !== 'update' &&
                reviewed.actionType !== 'delete') ||
            typeof reviewed.targetType !== 'string' ||
            typeof reviewed.targetId !== 'string' ||
            typeof reviewed.label !== 'string' ||
            reviewedDetails.label !== reviewed.label ||
            reviewedDetails.mutationSteps !== 1 ||
            typeof execution.groupId !== 'string' ||
            !execution.groupId ||
            typeof execution.operation !== 'string' ||
            !execution.operation ||
            !Number.isInteger(execution.step) ||
            !Number.isInteger(execution.stepCount) ||
            (execution.step as number) < 1 ||
            (execution.stepCount as number) < (execution.step as number) ||
            stableJson({
                actionType: reviewed.actionType,
                details: reviewedDetails,
                targetId: reviewed.targetId,
                targetType: reviewed.targetType,
            }) !==
                stableJson({
                    actionType: action.actionType,
                    details: action.details,
                    targetId: action.targetId,
                    targetType: action.targetType,
                })
        ) {
            throw new Error('structure-execution-action-ledger-invalid');
        }
        if (reviewed.actionType === 'delete') {
            deleteSetKeys.push(`${reviewed.targetType}:${reviewed.targetId}`);
        }
    }
    return { deleteActionCount: deleteSetKeys.length, deleteSetKeys: deleteSetKeys.sort() };
}

function stableJson(value: unknown): string {
    return JSON.stringify(canonicalJsonValue(value));
}

function canonicalJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalJsonValue);
    const record = normalizeRecord(value);
    if (!record) return value;
    return Object.fromEntries(
        Object.entries(record)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, canonicalJsonValue(item)])
    );
}

function normalizeStructureExecutionIdMap(value: unknown): Record<string, string> {
    const record = normalizeRecord(value);
    if (!record) throw new Error('structure-execution-id-map-invalid');

    const normalized: Record<string, string> = {};
    for (const [sourceIdValue, targetIdValue] of Object.entries(record)) {
        const sourceId = sourceIdValue.trim();
        if (
            !sourceId ||
            sourceId !== sourceIdValue ||
            typeof targetIdValue !== 'string' ||
            !targetIdValue.trim() ||
            targetIdValue !== targetIdValue.trim()
        ) {
            throw new Error('structure-execution-id-map-invalid');
        }
        normalized[sourceId] = targetIdValue;
    }
    return normalized;
}
