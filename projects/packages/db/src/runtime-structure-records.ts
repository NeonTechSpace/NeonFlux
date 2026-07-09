import type {
    StructureBackupRecord,
    StructureBackupRetentionPruneRecord,
    StructureBackupSettingsRecord,
    StructureBackupSummaryPageRecord,
    StructureBackupSummaryRecord,
    StructureImportActionPageRecord,
    StructureImportActionRecord,
    StructureImportRunRecord,
    StructureImportRunWithActionsRecord,
    StructureObservedEventStateRecord,
} from './contracts-structure.js';
import type { GuildFeatureRepositoryError } from './contracts.js';
import { err, ok, type Result } from 'neverthrow';

export type ConvexStructureBackupRecord = Omit<StructureBackupRecord, 'completedAt' | 'createdAt'> & {
    completedAt: string;
    createdAt: string;
};
export type ConvexStructureBackupSummaryRecord = Omit<ConvexStructureBackupRecord, 'structure'>;
export type ConvexStructureBackupSummaryPageRecord = {
    backups: ConvexStructureBackupSummaryRecord[];
    nextCursor: string | null;
};
export type ConvexStructureBackupSettingsRecord = Omit<
    StructureBackupSettingsRecord,
    | 'createdAt'
    | 'lastAttemptAt'
    | 'lastDriftFieldSummary'
    | 'lastDriftLiveCounts'
    | 'lastDriftSummary'
    | 'lastDriftCheckedAt'
    | 'lastSuccessAt'
    | 'nextBackupAt'
    | 'nextDriftCheckAt'
    | 'nextRetentionPruneAt'
    | 'updatedAt'
> & {
    createdAt?: string;
    lastAttemptAt: string | null;
    lastDriftCheckedAt: string | null;
    lastDriftFieldSummary: Record<string, unknown> | null;
    lastDriftLiveCounts: Record<string, unknown> | null;
    lastDriftSummary: Record<string, unknown> | null;
    lastSuccessAt: string | null;
    nextBackupAt: string | null;
    nextDriftCheckAt: string | null;
    nextRetentionPruneAt: string | null;
    updatedAt?: string;
};
export type ConvexStructureBackupRetentionPruneRecord = {
    deletedCount: number;
    hasMore: boolean;
    nextRetentionPruneAt: string | null;
};
export type ConvexStructureImportRunRecord = Omit<
    StructureImportRunRecord,
    'appliedAt' | 'confirmedAt' | 'createdAt' | 'updatedAt'
> & {
    appliedAt: string | null;
    confirmedAt: string | null;
    createdAt: string;
    updatedAt: string;
};
export type ConvexStructureImportActionRecord = Omit<StructureImportActionRecord, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
};
export type ConvexStructureImportActionPageRecord = {
    actions: ConvexStructureImportActionRecord[];
    nextCursor: string | null;
};
export type ConvexStructureImportRunWithActionsRecord = ConvexStructureImportRunRecord & {
    actions: ConvexStructureImportActionRecord[];
};
export type ConvexStructureObservedEventStateRecord = Omit<
    StructureObservedEventStateRecord,
    'createdAt' | 'lastObservedAt' | 'updatedAt'
> & {
    createdAt?: string;
    lastObservedAt?: string;
    updatedAt?: string;
};

export function toBackupRecord(record: ConvexStructureBackupRecord): StructureBackupRecord {
    return {
        ...record,
        completedAt: new Date(record.completedAt),
        createdAt: new Date(record.createdAt),
    };
}

export function toBackupSummaryRecord(record: ConvexStructureBackupSummaryRecord): StructureBackupSummaryRecord {
    const { structure, ...summary } = record as ConvexStructureBackupRecord;
    void structure;

    return {
        ...summary,
        completedAt: new Date(summary.completedAt),
        createdAt: new Date(summary.createdAt),
    };
}

export function toBackupSummaryPageRecord(
    record: ConvexStructureBackupSummaryPageRecord
): StructureBackupSummaryPageRecord {
    return {
        backups: record.backups.map(toBackupSummaryRecord),
        nextCursor: record.nextCursor,
    };
}

export function toBackupSettingsRecord(record: ConvexStructureBackupSettingsRecord): StructureBackupSettingsRecord {
    return {
        cadenceWeeks: record.cadenceWeeks,
        enabled: record.enabled,
        guildId: record.guildId,
        ...(record.createdAt ? { createdAt: new Date(record.createdAt) } : {}),
        lastErrorMessage: record.lastErrorMessage,
        lastAttemptAt: record.lastAttemptAt ? new Date(record.lastAttemptAt) : null,
        lastDriftBaselineBackupId: record.lastDriftBaselineBackupId ?? null,
        lastDriftBaselineName: record.lastDriftBaselineName ?? null,
        lastDriftChangeCount: record.lastDriftChangeCount ?? null,
        lastDriftCheckedAt: record.lastDriftCheckedAt ? new Date(record.lastDriftCheckedAt) : null,
        lastDriftErrorMessage: record.lastDriftErrorMessage ?? null,
        lastDriftFieldSummary: toDriftFieldSummaryRecord(record.lastDriftFieldSummary),
        lastDriftHasMorePreview: record.lastDriftHasMorePreview === true,
        lastDriftLiveCounts: toDriftLiveCountsRecord(record.lastDriftLiveCounts),
        lastDriftStatus: record.lastDriftStatus ?? null,
        lastDriftSummary: toDriftSummaryRecord(record.lastDriftSummary),
        lastSuccessAt: record.lastSuccessAt ? new Date(record.lastSuccessAt) : null,
        nextBackupAt: record.nextBackupAt ? new Date(record.nextBackupAt) : null,
        nextDriftCheckAt: record.nextDriftCheckAt ? new Date(record.nextDriftCheckAt) : null,
        nextRetentionPruneAt: record.nextRetentionPruneAt ? new Date(record.nextRetentionPruneAt) : null,
        retentionDays: record.retentionDays,
        ...(record.updatedAt ? { updatedAt: new Date(record.updatedAt) } : {}),
    };
}

function toDriftSummaryRecord(record: Record<string, unknown> | null) {
    if (!record) return null;

    return {
        creates: readNonNegativeInteger(record.creates),
        updates: readNonNegativeInteger(record.updates),
        deletes: readNonNegativeInteger(record.deletes),
        roles: readNonNegativeInteger(record.roles),
        categories: readNonNegativeInteger(record.categories),
        channels: readNonNegativeInteger(record.channels),
    };
}

function toDriftFieldSummaryRecord(record: Record<string, unknown> | null) {
    if (!record) return null;

    return {
        names: readNonNegativeInteger(record.names),
        permissions: readNonNegativeInteger(record.permissions),
        positions: readNonNegativeInteger(record.positions),
        parentMoves: readNonNegativeInteger(record.parentMoves),
        typeChanges: readNonNegativeInteger(record.typeChanges),
        roleVisuals: readNonNegativeInteger(record.roleVisuals),
    };
}

function toDriftLiveCountsRecord(record: Record<string, unknown> | null) {
    if (!record) return null;

    return {
        roles: readNonNegativeInteger(record.roles),
        categories: readNonNegativeInteger(record.categories),
        channels: readNonNegativeInteger(record.channels),
    };
}

function readNonNegativeInteger(value: unknown): number {
    return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : 0;
}

export function toBackupRetentionPruneRecord(
    record: ConvexStructureBackupRetentionPruneRecord
): StructureBackupRetentionPruneRecord {
    return {
        deletedCount: record.deletedCount,
        hasMore: record.hasMore,
        nextRetentionPruneAt: record.nextRetentionPruneAt ? new Date(record.nextRetentionPruneAt) : null,
    };
}

export function toImportRunRecord(record: ConvexStructureImportRunRecord): StructureImportRunRecord {
    return {
        ...record,
        appliedAt: record.appliedAt ? new Date(record.appliedAt) : null,
        confirmedAt: record.confirmedAt ? new Date(record.confirmedAt) : null,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

export function toImportActionRecord(record: ConvexStructureImportActionRecord): StructureImportActionRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

export function toImportActionPageRecord(
    record: ConvexStructureImportActionPageRecord
): StructureImportActionPageRecord {
    return {
        actions: record.actions.map(toImportActionRecord),
        nextCursor: record.nextCursor,
    };
}

export function toImportRunWithActionsRecord(
    record: ConvexStructureImportRunWithActionsRecord
): StructureImportRunWithActionsRecord {
    return {
        ...toImportRunRecord(record),
        actions: record.actions.map(toImportActionRecord),
    };
}

export function toObservedEventStateRecord(
    record: ConvexStructureObservedEventStateRecord
): StructureObservedEventStateRecord {
    return {
        guildId: record.guildId,
        ...(record.lastEventType ? { lastEventType: record.lastEventType } : {}),
        ...(record.lastTargetId ? { lastTargetId: record.lastTargetId } : {}),
        ...(record.lastTargetType ? { lastTargetType: record.lastTargetType } : {}),
        observedChangeCount: record.observedChangeCount,
        targetChangeCounts: record.targetChangeCounts,
        ...(record.createdAt ? { createdAt: new Date(record.createdAt) } : {}),
        ...(record.lastObservedAt ? { lastObservedAt: new Date(record.lastObservedAt) } : {}),
        ...(record.updatedAt ? { updatedAt: new Date(record.updatedAt) } : {}),
    };
}

export function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();
    return normalizedValue ? ok(normalizedValue) : err({ field, type: 'missing-input' });
}

export function normalizeOptionalText(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();
    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

export function normalizeLimit(value: number | undefined, fallback = 20): Result<number, GuildFeatureRepositoryError> {
    const limit = value ?? fallback;
    return Number.isInteger(limit) && limit > 0
        ? ok(Math.min(limit, 100))
        : err({ field: 'limit', type: 'invalid-value' });
}

export function normalizeCadenceWeeks(
    value: number | undefined,
    fallback = 1
): Result<number, GuildFeatureRepositoryError> {
    const cadenceWeeks = value ?? fallback;
    return Number.isInteger(cadenceWeeks) && cadenceWeeks >= 1
        ? ok(cadenceWeeks)
        : err({ field: 'cadenceWeeks', type: 'invalid-value' });
}

export function normalizeBackupName(
    value: string | null | undefined,
    field = 'name'
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.replace(/\s+/g, ' ').trim();
    if (!normalizedValue) return err({ field, type: 'missing-input' });
    if (normalizedValue.length > 120) return err({ field, type: 'invalid-value' });
    return ok(normalizedValue);
}

export function normalizeRetentionDays(
    value: number | undefined,
    fallback = 180
): Result<number, GuildFeatureRepositoryError> {
    const retentionDays = value ?? fallback;
    return Number.isInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 180
        ? ok(retentionDays)
        : err({ field: 'retentionDays', type: 'invalid-value' });
}
