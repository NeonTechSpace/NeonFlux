import {
    normalizeBlueprintPlanStep,
    normalizeBlueprintPersistedPlanAuthority,
} from '@neonflux/blueprint/runtime-contracts';
import { normalizeBlueprintSnapshot } from '@neonflux/blueprint/snapshot';
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

type StructureBackupSource = (typeof STRUCTURE_BACKUP_SOURCE)[keyof typeof STRUCTURE_BACKUP_SOURCE];
type StructureBackupStatus = (typeof STRUCTURE_BACKUP_STATUS)[keyof typeof STRUCTURE_BACKUP_STATUS];

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

export const BLUEPRINT_PLAN_STATUS = {
    draft: 'draft',
    needsInput: 'needs_input',
    reviewReady: 'review_ready',
    approved: 'approved',
    obsolete: 'obsolete',
} as const;

export type StructureBackupInput = {
    categoryCount?: number | null;
    channelCount?: number | null;
    completedAt?: string | null;
    createdAt?: string | null;
    createdByUserId?: string | null;
    errorMessage?: string | null;
    guildId?: string | null;
    deleteStepCount?: number | null;
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
    source: StructureBackupSource;
    status: StructureBackupStatus;
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

export type BlueprintPlanInput = {
    createdAt?: string | null;
    createdByUserId?: string | null;
    guildId?: string | null;
    deleteStepCount?: number | null;
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

export type BlueprintPlanDocument = {
    createdAt: string;
    createdByUserId?: string;
    guildId: string;
    deleteStepCount: number;
    deleteSetDigest?: string;
    planDigest: string;
    planVersion: number;
    policy: 'merge' | 'synchronize' | 'rebuild';
    plan: Record<string, unknown>;
    requestedSnapshotDigest: string;
    sourceBackupId?: GenericId<'structureBackups'>;
    status: 'draft' | 'needs_input' | 'review_ready' | 'approved' | 'obsolete';
    updatedAt: string;
};

export type BlueprintPlanStepInput = {
    actionType?: string | null;
    createdAt?: string | null;
    details?: Record<string, unknown> | null;
    planId?: string | null;
    sequence?: number | null;
    targetId?: string | null;
    targetType?: string | null;
};

export type BlueprintPlanStepDocument = {
    actionType: 'create' | 'update' | 'delete';
    createdAt: string;
    details: Record<string, unknown>;
    planId: GenericId<'blueprintPlans'>;
    sequence: number;
    targetId?: string;
    targetType: 'role' | 'category' | 'channel' | 'channel-order' | 'role-order';
};

export type StructureObservedEventStateDocument = {
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    feature: 'blueprint';
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
    source: StructureBackupSource;
    status: StructureBackupStatus;
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

export type BlueprintPlanRecord = {
    createdAt: string;
    createdByUserId: string | null;
    guildId: string;
    deleteStepCount: number;
    deleteSetDigest: string | null;
    planDigest: string;
    planVersion: number;
    policy: 'merge' | 'synchronize' | 'rebuild';
    id: string;
    plan: Record<string, unknown>;
    requestedSnapshotDigest: string;
    sourceBackupId: string | null;
    status: 'draft' | 'needs_input' | 'review_ready' | 'approved' | 'obsolete';
    updatedAt: string;
};

export type BlueprintPlanStepRecord = {
    actionType: string;
    createdAt: string;
    details: Record<string, unknown>;
    id: string;
    planId: string;
    sequence: number;
    targetId: string | null;
    targetType: string;
};

export type BlueprintPlanStepPageRecord = {
    steps: BlueprintPlanStepRecord[];
    nextCursor: string | null;
};

export type BlueprintPlanWithStepsRecord = BlueprintPlanRecord & {
    steps: BlueprintPlanStepRecord[];
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
    if (structure && normalizeBlueprintSnapshot(structure).type === 'invalid') {
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

export function buildBlueprintPlanDocument(
    input: BlueprintPlanInput,
    now: string
): StructureInputResult<BlueprintPlanDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const deleteStepCount = input.deleteStepCount;
    const deleteSetDigest = normalizeOptionalString(input.deleteSetDigest);
    const planDigest = normalizeRequiredString(input.planDigest, 'planDigest');
    const requestedSnapshotDigest = normalizeRequiredString(input.requestedSnapshotDigest, 'requestedSnapshotDigest');
    const policy = normalizeImportPolicy(input.policy);
    const status = normalizeBlueprintPlanStatus(input.status);
    const plan = normalizeRecord(input.plan ?? {});
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) return guildId;
    if (typeof deleteStepCount !== 'number' || !Number.isInteger(deleteStepCount) || deleteStepCount < 0)
        return { error: { field: 'deleteStepCount', type: 'invalid-value' }, ok: false };
    if (deleteStepCount > 0 && !deleteSetDigest)
        return { error: { field: 'deleteSetDigest', type: 'missing-input' }, ok: false };
    if (deleteStepCount === 0 && deleteSetDigest)
        return { error: { field: 'deleteSetDigest', type: 'invalid-value' }, ok: false };
    if (!planDigest.ok) return planDigest;
    if (!requestedSnapshotDigest.ok) return requestedSnapshotDigest;
    if (!policy) return { error: { field: 'policy', type: 'invalid-value' }, ok: false };
    if (!status) return { error: { field: 'status', type: 'invalid-value' }, ok: false };
    if (input.planVersion !== 3) return { error: { field: 'planVersion', type: 'invalid-value' }, ok: false };
    if (!plan || normalizeBlueprintPersistedPlanAuthority(plan).type === 'invalid') {
        return { error: { field: 'plan', type: 'invalid-value' }, ok: false };
    }
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
            deleteStepCount,
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

export function buildBlueprintPlanStepDocument(
    input: BlueprintPlanStepInput,
    now: string
): StructureInputResult<BlueprintPlanStepDocument> {
    const planId = normalizeRequiredString(input.planId, 'planId');
    const actionType = normalizeRequiredString(input.actionType, 'actionType');
    const targetType = normalizeRequiredString(input.targetType, 'targetType');
    const details = normalizeRecord(input.details ?? {});
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);

    if (!planId.ok) return planId;
    if (!actionType.ok) return actionType;
    if (!targetType.ok) return targetType;
    if (!details) return { error: { field: 'details', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };

    const sequence = normalizeRequiredNonNegativeInteger(input.sequence);
    const targetId = normalizeOptionalString(input.targetId);
    const normalizedActionType = normalizeBlueprintPlanStepType(actionType.value);
    const normalizedTargetType = normalizeImportTargetType(targetType.value);

    if (sequence === undefined) return { error: { field: 'sequence', type: 'invalid-value' }, ok: false };
    if (!normalizedActionType) return { error: { field: 'actionType', type: 'invalid-value' }, ok: false };
    if (!normalizedTargetType) return { error: { field: 'targetType', type: 'invalid-value' }, ok: false };
    if (
        normalizeBlueprintPlanStep({
            actionType: normalizedActionType,
            details,
            label: details.label,
            targetId,
            targetType: normalizedTargetType,
        }).type === 'invalid'
    ) {
        return { error: { field: 'details', type: 'invalid-value' }, ok: false };
    }

    return {
        ok: true,
        value: {
            actionType: normalizedActionType,
            createdAt,
            details,
            planId: planId.value as GenericId<'blueprintPlans'>,
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
            feature: 'blueprint',
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

export function toBlueprintPlanRecord(document: BlueprintPlanDocument & { _id: string }): BlueprintPlanRecord {
    return {
        createdAt: document.createdAt,
        createdByUserId: document.createdByUserId ?? null,
        guildId: document.guildId,
        deleteStepCount: document.deleteStepCount,
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

export function toBlueprintPlanStepRecord(
    document: BlueprintPlanStepDocument & { _id: string }
): BlueprintPlanStepRecord {
    return {
        actionType: document.actionType,
        createdAt: document.createdAt,
        details: document.details,
        id: document._id,
        planId: document.planId,
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

export function classifyBlueprintRunReclaim(input: {
    hasStartedAttempt: boolean;
    leaseExpiresAt?: string;
    now: string;
}): 'active' | 'outcome_unknown' | 'reclaim' {
    if (!input.leaseExpiresAt || input.leaseExpiresAt > input.now) return 'active';
    return input.hasStartedAttempt ? 'outcome_unknown' : 'reclaim';
}

export function classifyBlueprintRunPreMutationAuthorization(input: {
    completedMutationSteps: number;
    expectedLiveFingerprint: string;
    expiresAt: string;
    liveFingerprint?: string;
    nextStepSequence: number;
    now: string;
}) {
    if (input.nextStepSequence > 0 || input.completedMutationSteps > 0) return 'not_required' as const;
    if (input.expiresAt <= input.now) return 'preflight_expired' as const;
    if (input.liveFingerprint === undefined) return 'authorization_required' as const;
    return input.liveFingerprint === input.expectedLiveFingerprint
        ? ('authorized' as const)
        : ('live_fingerprint_stale' as const);
}

export function resolveBlueprintRunMutationAuthorization(input: {
    completedMutationSteps: number;
    expectedLiveFingerprint: string;
    expiresAt: string;
    leaseId: string;
    liveFingerprint: string;
    nextStepSequence: number;
    now: string;
    structure: unknown;
}):
    | { type: 'not_required' | 'preflight_expired' | 'live_fingerprint_stale' }
    | {
          type: 'authorized';
          runPatch: {
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
    const authorization = classifyBlueprintRunPreMutationAuthorization(input);
    if (authorization === 'authorization_required') return { type: 'invalid_snapshot' };
    if (authorization !== 'authorized') return { type: authorization };
    const snapshot = normalizeBlueprintSnapshot(input.structure);
    if (snapshot.type === 'invalid') return { type: 'invalid_snapshot' };
    const structure = snapshot.snapshot;
    return {
        type: 'authorized',
        runPatch: {
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

export function isBlueprintRunMutationAuthorizedForLease(input: {
    completedMutationSteps: number;
    expiresAt: string;
    leaseId: string;
    mutationAuthorizedAt?: string;
    mutationAuthorizationLeaseId?: string;
    nextStepSequence: number;
    now: string;
}): boolean {
    if (input.nextStepSequence > 0 || input.completedMutationSteps > 0) return true;
    return (
        input.expiresAt > input.now &&
        Boolean(input.mutationAuthorizedAt) &&
        input.mutationAuthorizationLeaseId === input.leaseId
    );
}

export function isBlueprintRunRetryPreflightFresh(input: {
    latestRun?: { status: string; updatedAt: string } | null;
    preflightCheckedAt: string;
}): boolean {
    return input.latestRun?.status !== 'failed_before_mutation' || input.preflightCheckedAt > input.latestRun.updatedAt;
}

export function resolveExpiredBlueprintRunControl(controlRequest: unknown): 'paused' | 'cancelled' {
    return controlRequest === 'cancel' ? 'cancelled' : 'paused';
}

export function resolveBlueprintRunStepAttemptCompletionStatus(input: {
    controlRequest: unknown;
    runStatus: string;
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
    if (requestedTerminal || input.runStatus !== 'pause_requested') return input.requestedStatus;
    return input.controlRequest === 'cancel' ? 'cancelled' : 'paused';
}

export function validateBlueprintPlanDecisionSequences(
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

export function isBlueprintPlanDecisionLedgerComplete(
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

function normalizeBackupSource(value: string | null | undefined): StructureBackupSource | undefined {
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

function normalizeBackupStatus(value: string | null | undefined): StructureBackupStatus | undefined {
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

function normalizeBlueprintPlanStatus(value: string | null | undefined): BlueprintPlanDocument['status'] | undefined {
    const status = normalizeOptionalString(value) ?? BLUEPRINT_PLAN_STATUS.draft;
    return status === 'draft' ||
        status === 'needs_input' ||
        status === 'review_ready' ||
        status === 'approved' ||
        status === 'obsolete'
        ? status
        : undefined;
}

function normalizeBlueprintPlanStepType(value: string): BlueprintPlanStepDocument['actionType'] | undefined {
    return value === 'create' || value === 'update' || value === 'delete' ? value : undefined;
}

function normalizeImportTargetType(value: string): BlueprintPlanStepDocument['targetType'] | undefined {
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

export function resolveBlueprintRunReferenceAuthority(plan: unknown): {
    idMap: Record<string, string>;
    knownTargetKinds: Record<string, 'role' | 'category' | 'channel'>;
} {
    const planRecord = normalizeRecord(plan);
    const sourceTargetMap = normalizeRecord(planRecord?.sourceTargetMap);
    const knownTargetKinds = normalizeRecord(planRecord?.knownTargetKinds);
    if (!sourceTargetMap) throw new Error('blueprint-plan-source-target-map-invalid');
    if (!knownTargetKinds) throw new Error('blueprint-plan-known-target-kinds-invalid');

    const resolved: Record<string, string> = {};
    const resolvedTargetIds = new Set<string>();
    for (const [sourceIdValue, targetIdValue] of Object.entries(sourceTargetMap)) {
        const sourceId = sourceIdValue.trim();
        if (!sourceId || sourceId !== sourceIdValue) {
            throw new Error('blueprint-plan-source-target-map-invalid');
        }
        if (targetIdValue === null) continue;
        if (typeof targetIdValue !== 'string' || !targetIdValue.trim() || targetIdValue !== targetIdValue.trim()) {
            throw new Error('blueprint-plan-source-target-map-invalid');
        }
        if (resolvedTargetIds.has(targetIdValue)) throw new Error('blueprint-plan-source-target-map-invalid');
        resolved[sourceId] = targetIdValue;
        resolvedTargetIds.add(targetIdValue);
    }

    const knownTargetIdSet = new Set(Object.keys(knownTargetKinds));
    if (Object.values(resolved).some((targetId) => !knownTargetIdSet.has(targetId))) {
        throw new Error('blueprint-plan-source-target-map-invalid');
    }

    const normalizedTargetKinds: Record<string, 'role' | 'category' | 'channel'> = {};
    for (const [id, kind] of Object.entries(knownTargetKinds)) {
        if (!id.trim() || id !== id.trim() || (kind !== 'role' && kind !== 'category' && kind !== 'channel')) {
            throw new Error('blueprint-plan-known-target-kinds-invalid');
        }
        normalizedTargetKinds[id] = kind;
    }
    const targetIds = Object.keys(normalizedTargetKinds);
    if (
        !targetIds.every((id, index) => [...targetIds].sort((left, right) => left.localeCompare(right))[index] === id)
    ) {
        throw new Error('blueprint-plan-known-target-kinds-invalid');
    }

    return {
        idMap: resolved,
        knownTargetKinds: normalizedTargetKinds,
    };
}

export function resolveBlueprintRunIdMap(plan: unknown): Record<string, string> {
    return resolveBlueprintRunReferenceAuthority(plan).idMap;
}

export function validateBlueprintRunIdMapTransition(input: {
    next: unknown;
    plan: unknown;
    previous: unknown;
}): Record<string, string> {
    const sourceTargetMap = normalizeRecord(normalizeRecord(input.plan)?.sourceTargetMap);
    const previous = normalizeBlueprintRunIdMap(input.previous);
    const next = normalizeBlueprintRunIdMap(input.next);
    const initial = resolveBlueprintRunIdMap(input.plan);
    if (!sourceTargetMap) throw new Error('blueprint-plan-source-target-map-invalid');

    for (const sourceId of Object.keys(initial)) {
        if (!Object.hasOwn(previous, sourceId) || !Object.hasOwn(next, sourceId)) {
            throw new Error('blueprint-run-id-map-conflict');
        }
    }
    validateBlueprintRunIdMapEntries(previous, sourceTargetMap);
    for (const [sourceId, targetId] of Object.entries(previous)) {
        if (next[sourceId] !== targetId) throw new Error('blueprint-run-id-map-regression');
    }
    validateBlueprintRunIdMapEntries(next, sourceTargetMap);

    return next;
}

function validateBlueprintRunIdMapEntries(
    idMap: Record<string, string>,
    sourceTargetMap: Record<string, unknown>
): void {
    const targetIds = new Set<string>();
    for (const [sourceId, targetId] of Object.entries(idMap)) {
        if (!Object.hasOwn(sourceTargetMap, sourceId)) throw new Error('blueprint-run-id-map-unknown-source');
        if (targetIds.has(targetId)) throw new Error('blueprint-run-id-map-conflict');
        targetIds.add(targetId);
    }
}

export function validateBlueprintRunCheckpointIdMap(input: {
    next: unknown;
    plan: unknown;
    previous: unknown;
}): Record<string, string> {
    const previous = normalizeBlueprintRunIdMap(input.previous);
    const next = validateBlueprintRunIdMapTransition(input);
    if (stableJson(previous) !== stableJson(next)) throw new Error('blueprint-run-id-map-checkpoint-change');
    return next;
}

export function validateBlueprintRunAttemptIdMapTransition(input: {
    planStep: { actionType: string; targetId?: string };
    attemptState: string;
    createdId?: string;
    next: unknown;
    plan: unknown;
    previous: unknown;
    resultState: 'applied' | 'failed' | 'unknown';
}): Record<string, string> {
    const previous = normalizeBlueprintRunIdMap(input.previous);
    validateBlueprintRunIdMapTransition({ ...input, next: previous, previous });
    const next = normalizeBlueprintRunIdMap(input.next);
    if (
        input.attemptState === 'started' &&
        input.resultState === 'applied' &&
        input.planStep.actionType === 'create' &&
        typeof input.planStep.targetId === 'string' &&
        input.planStep.targetId.length > 0 &&
        typeof input.createdId === 'string' &&
        input.createdId.length > 0
    ) {
        const sourceTargetMap = normalizeRecord(normalizeRecord(input.plan)?.sourceTargetMap);
        const knownTargetKinds = resolveBlueprintRunReferenceAuthority(input.plan).knownTargetKinds;
        const changedSources = new Set([...Object.keys(previous), ...Object.keys(next)]);
        for (const sourceId of [...changedSources]) {
            if (previous[sourceId] === next[sourceId]) changedSources.delete(sourceId);
        }
        const targetIds = Object.values(next);
        if (
            !sourceTargetMap ||
            !Object.hasOwn(sourceTargetMap, input.planStep.targetId) ||
            changedSources.size !== 1 ||
            !changedSources.has(input.planStep.targetId) ||
            next[input.planStep.targetId] !== input.createdId ||
            previous[input.planStep.targetId] === input.createdId ||
            Object.hasOwn(knownTargetKinds, input.createdId) ||
            new Set(targetIds).size !== targetIds.length
        ) {
            throw new Error('blueprint-run-create-id-map-invalid');
        }
        return next;
    }
    validateBlueprintRunIdMapTransition({ ...input, next, previous });
    if (input.createdId !== undefined || stableJson(previous) !== stableJson(next)) {
        throw new Error('blueprint-run-id-map-attempt-change');
    }
    return next;
}

export function validateBlueprintRunProgressTransition(input: {
    next: {
        appliedSteps: number;
        completedMutationSteps: number;
        failedSteps: number;
        nextStepSequence: number;
        notStartedSteps: number;
        skippedSteps: number;
        totalMutationSteps: number;
    };
    previous: {
        appliedSteps: number;
        completedMutationSteps: number;
        failedSteps: number;
        nextStepSequence: number;
        skippedSteps: number;
        totalSteps: number;
        totalMutationSteps: number;
    };
}): void {
    const { next, previous } = input;
    if (
        [
            next.appliedSteps,
            next.completedMutationSteps,
            next.failedSteps,
            next.nextStepSequence,
            next.notStartedSteps,
            next.skippedSteps,
            next.totalMutationSteps,
        ].some((value) => !Number.isInteger(value) || value < 0) ||
        next.nextStepSequence > previous.totalSteps ||
        next.completedMutationSteps > next.totalMutationSteps ||
        next.totalMutationSteps !== previous.totalMutationSteps ||
        previous.totalMutationSteps !== previous.totalSteps ||
        next.completedMutationSteps !== next.appliedSteps ||
        next.appliedSteps + next.failedSteps + next.skippedSteps !== next.nextStepSequence ||
        next.notStartedSteps !== previous.totalSteps - next.nextStepSequence
    ) {
        throw new Error('blueprint-run-progress-invalid');
    }
    if (
        next.appliedSteps < previous.appliedSteps ||
        next.completedMutationSteps < previous.completedMutationSteps ||
        next.failedSteps < previous.failedSteps ||
        next.nextStepSequence < previous.nextStepSequence ||
        next.skippedSteps < previous.skippedSteps
    ) {
        throw new Error('blueprint-run-progress-regression');
    }
}

export function validateBlueprintRunPlanStepLedger(
    plan: unknown,
    steps: ReadonlyArray<{
        actionType: string;
        details: unknown;
        sequence: number;
        targetId?: string;
        targetType: string;
    }>
): { deleteStepCount: number; deleteSetKeys: string[] } {
    const planRecord = normalizeRecord(plan);
    const fingerprintInput = normalizeRecord(planRecord?.fingerprintInput);
    const reviewedSteps = planRecord?.steps;
    const fingerprintSteps = fingerprintInput?.steps;
    if (!Array.isArray(reviewedSteps) || !Array.isArray(fingerprintSteps)) {
        throw new Error('blueprint-run-step-ledger-invalid');
    }
    if (stableJson(reviewedSteps) !== stableJson(fingerprintSteps) || reviewedSteps.length !== steps.length) {
        throw new Error('blueprint-run-step-ledger-invalid');
    }
    const deleteSetKeys: string[] = [];
    for (const [sequence, reviewedValue] of reviewedSteps.entries()) {
        const reviewed = normalizeRecord(reviewedValue);
        const step = steps[sequence];
        const reviewedDetails = normalizeRecord(reviewed?.details);
        const provider = normalizeRecord(reviewedDetails?.provider);
        if (
            !reviewed ||
            !reviewedDetails ||
            !provider ||
            step?.sequence !== sequence ||
            (reviewed.actionType !== 'create' &&
                reviewed.actionType !== 'update' &&
                reviewed.actionType !== 'delete') ||
            typeof reviewed.targetType !== 'string' ||
            typeof reviewed.targetId !== 'string' ||
            typeof reviewed.label !== 'string' ||
            reviewedDetails.label !== reviewed.label ||
            reviewedDetails.mutationSteps !== 1 ||
            typeof provider.groupId !== 'string' ||
            !provider.groupId ||
            typeof provider.operation !== 'string' ||
            !provider.operation ||
            !Number.isInteger(provider.step) ||
            !Number.isInteger(provider.stepCount) ||
            (provider.step as number) < 1 ||
            (provider.stepCount as number) < (provider.step as number) ||
            stableJson({
                actionType: reviewed.actionType,
                details: reviewedDetails,
                targetId: reviewed.targetId,
                targetType: reviewed.targetType,
            }) !==
                stableJson({
                    actionType: step.actionType,
                    details: step.details,
                    targetId: step.targetId,
                    targetType: step.targetType,
                })
        ) {
            throw new Error('blueprint-run-step-ledger-invalid');
        }
        if (reviewed.actionType === 'delete') {
            deleteSetKeys.push(`${reviewed.targetType}:${reviewed.targetId}`);
        }
    }
    return { deleteStepCount: deleteSetKeys.length, deleteSetKeys: deleteSetKeys.sort() };
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

function normalizeBlueprintRunIdMap(value: unknown): Record<string, string> {
    const record = normalizeRecord(value);
    if (!record) throw new Error('blueprint-run-id-map-invalid');

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
            throw new Error('blueprint-run-id-map-invalid');
        }
        normalized[sourceId] = targetIdValue;
    }
    return normalized;
}
