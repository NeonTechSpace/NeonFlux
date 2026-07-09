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
    applied: 'applied',
    applying: 'applying',
    cancelled: 'cancelled',
    confirmed: 'confirmed',
    draft: 'draft',
    dryRunComplete: 'dry_run_complete',
    failed: 'failed',
} as const;

export const STRUCTURE_IMPORT_ACTION_STATUS = {
    applied: 'applied',
    dryRun: 'dry_run',
    failed: 'failed',
    pending: 'pending',
} as const;

export type StructureBackupInput = {
    categoryCount?: number | null;
    channelCount?: number | null;
    completedAt?: string | null;
    createdAt?: string | null;
    createdByUserId?: string | null;
    errorMessage?: string | null;
    guildId?: string | null;
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
    appliedAt?: string | null;
    confirmedAt?: string | null;
    createdAt?: string | null;
    createdByUserId?: string | null;
    guildId?: string | null;
    plan?: Record<string, unknown> | null;
    sourceBackupId?: string | null;
    status?: string | null;
    updatedAt?: string | null;
};

export type StructureImportRunDocument = {
    appliedAt?: string;
    confirmedAt?: string;
    createdAt: string;
    createdByUserId?: string;
    guildId: string;
    plan: Record<string, unknown>;
    sourceBackupId?: GenericId<'structureBackups'>;
    status: string;
    updatedAt: string;
};

export type StructureImportActionInput = {
    actionType?: string | null;
    createdAt?: string | null;
    details?: Record<string, unknown> | null;
    runId?: string | null;
    sequence?: number | null;
    status?: string | null;
    targetId?: string | null;
    targetType?: string | null;
    updatedAt?: string | null;
};

export type StructureImportActionDocument = {
    actionType: string;
    createdAt: string;
    details: Record<string, unknown>;
    runId: GenericId<'structureImportRuns'>;
    sequence: number;
    status: string;
    targetId?: string;
    targetType: string;
    updatedAt: string;
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
    appliedAt: string | null;
    confirmedAt: string | null;
    createdAt: string;
    createdByUserId: string | null;
    guildId: string;
    id: string;
    plan: Record<string, unknown>;
    sourceBackupId: string | null;
    status: string;
    updatedAt: string;
};

export type StructureImportActionRecord = {
    actionType: string;
    createdAt: string;
    details: Record<string, unknown>;
    id: string;
    runId: string;
    sequence: number;
    status: string;
    targetId: string | null;
    targetType: string;
    updatedAt: string;
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
export type StructureImportRunStatusPatch = {
    appliedAt?: string;
    confirmedAt?: string;
    plan: Record<string, unknown>;
    status: string;
    updatedAt: string;
};

const importRunStatusTransitions = new Map<string, readonly string[]>([
    [
        STRUCTURE_IMPORT_RUN_STATUS.draft,
        [STRUCTURE_IMPORT_RUN_STATUS.dryRunComplete, STRUCTURE_IMPORT_RUN_STATUS.cancelled],
    ],
    [
        STRUCTURE_IMPORT_RUN_STATUS.dryRunComplete,
        [STRUCTURE_IMPORT_RUN_STATUS.confirmed, STRUCTURE_IMPORT_RUN_STATUS.cancelled],
    ],
    [
        STRUCTURE_IMPORT_RUN_STATUS.confirmed,
        [STRUCTURE_IMPORT_RUN_STATUS.applying, STRUCTURE_IMPORT_RUN_STATUS.cancelled],
    ],
    [STRUCTURE_IMPORT_RUN_STATUS.applying, [STRUCTURE_IMPORT_RUN_STATUS.applied, STRUCTURE_IMPORT_RUN_STATUS.failed]],
    [STRUCTURE_IMPORT_RUN_STATUS.applied, []],
    [STRUCTURE_IMPORT_RUN_STATUS.cancelled, []],
    [STRUCTURE_IMPORT_RUN_STATUS.failed, []],
]);

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
    const plan = normalizeRecord(input.plan ?? {});
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);
    const confirmedAt = input.confirmedAt === undefined ? undefined : normalizeTimestamp(input.confirmedAt);
    const appliedAt = input.appliedAt === undefined ? undefined : normalizeTimestamp(input.appliedAt);

    if (!guildId.ok) return guildId;
    if (!plan) return { error: { field: 'plan', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    if (input.confirmedAt !== undefined && input.confirmedAt !== null && !confirmedAt) {
        return { error: { field: 'confirmedAt', type: 'invalid-value' }, ok: false };
    }
    if (input.appliedAt !== undefined && input.appliedAt !== null && !appliedAt) {
        return { error: { field: 'appliedAt', type: 'invalid-value' }, ok: false };
    }

    const createdByUserId = normalizeOptionalString(input.createdByUserId);
    const sourceBackupId = normalizeOptionalString(input.sourceBackupId);

    return {
        ok: true,
        value: {
            ...(appliedAt ? { appliedAt } : {}),
            ...(confirmedAt ? { confirmedAt } : {}),
            createdAt,
            ...(createdByUserId ? { createdByUserId } : {}),
            guildId: guildId.value,
            plan,
            ...(sourceBackupId ? { sourceBackupId: sourceBackupId as GenericId<'structureBackups'> } : {}),
            status: normalizeOptionalString(input.status) ?? STRUCTURE_IMPORT_RUN_STATUS.draft,
            updatedAt,
        },
    };
}

export function buildStructureImportRunStatusPatch(
    existing: Pick<StructureImportRunDocument, 'appliedAt' | 'confirmedAt' | 'plan' | 'status'>,
    input: { plan?: Record<string, unknown> | null; status?: string | null },
    now: string
): StructureInputResult<StructureImportRunStatusPatch> {
    const status = normalizeRequiredString(input.status, 'status');
    const plan = normalizeRecord(input.plan ?? existing.plan);

    if (!status.ok) return status;
    if (!plan) return { error: { field: 'plan', type: 'invalid-value' }, ok: false };

    const transition = assertAllowedStatusTransition(existing.status, status.value);
    if (!transition.ok) return transition;

    const appliedAt = status.value === STRUCTURE_IMPORT_RUN_STATUS.applied ? now : existing.appliedAt;
    const confirmedAt = status.value === STRUCTURE_IMPORT_RUN_STATUS.confirmed ? now : existing.confirmedAt;

    return {
        ok: true,
        value: {
            ...(appliedAt ? { appliedAt } : {}),
            ...(confirmedAt ? { confirmedAt } : {}),
            plan,
            status: status.value,
            updatedAt: now,
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
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!runId.ok) return runId;
    if (!actionType.ok) return actionType;
    if (!targetType.ok) return targetType;
    if (!details) return { error: { field: 'details', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    const sequence = normalizeRequiredNonNegativeInteger(input.sequence);
    const targetId = normalizeOptionalString(input.targetId);

    if (sequence === undefined) return { error: { field: 'sequence', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            actionType: actionType.value,
            createdAt,
            details,
            runId: runId.value as GenericId<'structureImportRuns'>,
            sequence,
            status: normalizeOptionalString(input.status) ?? STRUCTURE_IMPORT_ACTION_STATUS.pending,
            ...(targetId ? { targetId } : {}),
            targetType: targetType.value,
            updatedAt,
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
        appliedAt: document.appliedAt ?? null,
        confirmedAt: document.confirmedAt ?? null,
        createdAt: document.createdAt,
        createdByUserId: document.createdByUserId ?? null,
        guildId: document.guildId,
        id: document._id,
        plan: document.plan,
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
        status: document.status,
        targetId: document.targetId ?? null,
        targetType: document.targetType,
        updatedAt: document.updatedAt,
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

function assertAllowedStatusTransition(from: string, to: string): StructureInputResult<undefined> {
    if (from === to || importRunStatusTransitions.get(from)?.includes(to)) return { ok: true, value: undefined };
    return { error: { from, to, type: 'invalid-status-transition' }, ok: false };
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
