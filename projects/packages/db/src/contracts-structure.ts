import type { GuildFeatureRepositoryError } from './contracts.js';

export const STRUCTURE_IMPORT_EXPORT_FEATURE = 'import_export';

export const structureBackupSources = {
    manual: 'manual',
    restorePoint: 'restore_point',
    scheduled: 'scheduled',
} as const;

export const structureBackupStatuses = {
    failed: 'failed',
    succeeded: 'succeeded',
} as const;

export const structureScheduledDriftStatuses = {
    changed: 'changed',
    clean: 'clean',
    failed: 'failed',
    noBaseline: 'no_baseline',
} as const;

export const structureImportRunStatuses = {
    applied: 'applied',
    applying: 'applying',
    cancelled: 'cancelled',
    confirmed: 'confirmed',
    draft: 'draft',
    dryRunComplete: 'dry_run_complete',
    failed: 'failed',
} as const;

export const structureImportActionStatuses = {
    applied: 'applied',
    dryRun: 'dry_run',
    failed: 'failed',
    pending: 'pending',
} as const;

export const structureAuditActions = {
    backupCreated: 'structure.backup_created',
    backupDeleted: 'structure.backup_deleted',
    backupFailed: 'structure.backup_failed',
    backupImportCreated: 'structure.backup_import_created',
    backupRenamed: 'structure.backup_renamed',
    backupRestorePointCreated: 'structure.backup_restore_point_created',
    backupRetentionPruned: 'structure.backup_retention_pruned',
    backupSettingsUpdated: 'structure.backup_settings_updated',
    importApplied: 'structure.import_applied',
    importConfirmed: 'structure.import_confirmed',
    importDryRunCreated: 'structure.import_dry_run_created',
    importFailed: 'structure.import_failed',
    importPreflightChecked: 'structure.import_preflight_checked',
    importRetryCreated: 'structure.import_retry_created',
    scheduledDriftDetected: 'structure.scheduled_drift_detected',
    scheduledDriftFailed: 'structure.scheduled_drift_failed',
} as const;

export type StructureScheduledDriftSummaryRecord = {
    creates: number;
    updates: number;
    deletes: number;
    roles: number;
    categories: number;
    channels: number;
};

export type StructureScheduledDriftFieldSummaryRecord = {
    names: number;
    permissions: number;
    positions: number;
    parentMoves: number;
    typeChanges: number;
    roleVisuals: number;
};

export type StructureScheduledDriftLiveCountsRecord = {
    roles: number;
    categories: number;
    channels: number;
};

export type StructureBackupRecord = {
    id: string;
    guildId: string;
    name: string;
    createdByUserId: string | null;
    source: string;
    status: string;
    errorMessage: string | null;
    structure: Record<string, unknown> | null;
    roleCount: number;
    categoryCount: number;
    channelCount: number;
    createdAt: Date;
    completedAt: Date;
};

export type StructureBackupSummaryRecord = Omit<StructureBackupRecord, 'structure'>;

export type StructureBackupSummaryPageRecord = {
    backups: StructureBackupSummaryRecord[];
    nextCursor: string | null;
};

export type StructureBackupSettingsRecord = {
    guildId: string;
    enabled: boolean;
    cadenceWeeks: number;
    lastAttemptAt: Date | null;
    lastSuccessAt: Date | null;
    lastErrorMessage: string | null;
    nextBackupAt: Date | null;
    nextRetentionPruneAt: Date | null;
    nextDriftCheckAt: Date | null;
    lastDriftCheckedAt: Date | null;
    lastDriftStatus: string | null;
    lastDriftErrorMessage: string | null;
    lastDriftChangeCount: number | null;
    lastDriftBaselineBackupId: string | null;
    lastDriftBaselineName: string | null;
    lastDriftSummary: StructureScheduledDriftSummaryRecord | null;
    lastDriftFieldSummary: StructureScheduledDriftFieldSummaryRecord | null;
    lastDriftLiveCounts: StructureScheduledDriftLiveCountsRecord | null;
    lastDriftHasMorePreview: boolean;
    retentionDays: number;
    createdAt?: Date;
    updatedAt?: Date;
};

export type StructureBackupRetentionPruneRecord = {
    deletedCount: number;
    hasMore: boolean;
    nextRetentionPruneAt: Date | null;
};

export type StructureImportRunRecord = {
    id: string;
    guildId: string;
    createdByUserId: string | null;
    status: string;
    sourceBackupId: string | null;
    plan: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
    confirmedAt: Date | null;
    appliedAt: Date | null;
};

export type StructureImportActionRecord = {
    id: string;
    runId: string;
    sequence: number;
    actionType: string;
    targetType: string;
    targetId: string | null;
    status: string;
    details: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
};

export type StructureImportActionPageRecord = {
    actions: StructureImportActionRecord[];
    nextCursor: string | null;
};

export type StructureImportExportRepositoryError = GuildFeatureRepositoryError;

export type StructureImportRunWithActionsRecord = StructureImportRunRecord & {
    actions: StructureImportActionRecord[];
};

export type StructureObservedEventStateRecord = {
    guildId: string;
    observedChangeCount: number;
    targetChangeCounts: Record<string, number>;
    lastEventType?: string;
    lastTargetType?: string;
    lastTargetId?: string;
    lastObservedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
};
