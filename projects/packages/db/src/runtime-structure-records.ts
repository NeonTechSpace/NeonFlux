import type {
    StructureExportSnapshotRecord,
    StructureImportActionRecord,
    StructureImportRunRecord,
    StructureImportRunWithActionsRecord,
    StructureObservedEventStateRecord,
} from './contracts-structure.js';
import type { GuildFeatureRepositoryError } from './contracts.js';
import { err, ok, type Result } from 'neverthrow';

export type ConvexStructureExportSnapshotRecord = Omit<StructureExportSnapshotRecord, 'createdAt'> & {
    createdAt: string;
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

export function toExportSnapshotRecord(record: ConvexStructureExportSnapshotRecord): StructureExportSnapshotRecord {
    return { ...record, createdAt: new Date(record.createdAt) };
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
