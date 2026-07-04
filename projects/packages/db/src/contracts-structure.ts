import type { GuildFeatureRepositoryError } from './contracts.js';

export type StructureExportSnapshotRecord = {
    id: string;
    guildId: string;
    createdByUserId: string | null;
    source: string;
    snapshot: Record<string, unknown>;
    createdAt: Date;
};

export type StructureImportRunRecord = {
    id: string;
    guildId: string;
    createdByUserId: string | null;
    status: string;
    sourceSnapshotId: string | null;
    plan: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
    confirmedAt: Date | null;
    appliedAt: Date | null;
};

export type StructureImportActionRecord = {
    id: string;
    runId: string;
    actionType: string;
    targetType: string;
    targetId: string | null;
    status: string;
    details: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
};

export type StructureImportExportRepositoryError = GuildFeatureRepositoryError;

export type StructureImportRunWithActionsRecord = StructureImportRunRecord & {
    actions: StructureImportActionRecord[];
};

export type StructureObservedEventStateRecord = {
    guildId: string;
    observedChangeCount: number;
    lastEventType?: string;
    lastTargetType?: string;
    lastTargetId?: string;
    lastObservedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
};

export const STRUCTURE_IMPORT_EXPORT_FEATURE = 'import_export';
