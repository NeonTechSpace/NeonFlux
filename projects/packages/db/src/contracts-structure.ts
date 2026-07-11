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
    building: 'building',
    needsMapping: 'needs_mapping',
    reviewReady: 'review_ready',
    approved: 'approved',
    stale: 'stale',
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
    importPlanCreated: 'structure.import_plan_created',
    importPlanApproved: 'structure.import_plan_approved',
    importPreflightChecked: 'structure.import_preflight_checked',
    importExecutionQueued: 'structure.import_execution_queued',
    importExecutionSucceeded: 'structure.import_execution_succeeded',
    importExecutionPartiallyApplied: 'structure.import_execution_partially_applied',
    importExecutionNeedsReconciliation: 'structure.import_execution_needs_reconciliation',
    importExecutionOutcomeUnknown: 'structure.import_execution_outcome_unknown',
    importExecutionPaused: 'structure.import_execution_paused',
    importExecutionResumed: 'structure.import_execution_resumed',
    importExecutionCancelled: 'structure.import_execution_cancelled',
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
    deleteActionCount: number;
    deleteSetDigest: string | null;
    planDigest: string;
    planVersion: number;
    policy: 'merge' | 'synchronize' | 'rebuild';
    createdByUserId: string | null;
    status: string;
    sourceBackupId: string | null;
    plan: Record<string, unknown>;
    requestedSnapshotDigest: string;
    createdAt: Date;
    updatedAt: Date;
};

export const structureImportExecutionStatuses = {
    queued: 'queued',
    running: 'running',
    waitingRateLimit: 'waiting_rate_limit',
    pauseRequested: 'pause_requested',
    paused: 'paused',
    verifying: 'verifying',
    succeeded: 'succeeded',
    partiallyApplied: 'partially_applied',
    failedBeforeMutation: 'failed_before_mutation',
    needsReconciliation: 'needs_reconciliation',
    outcomeUnknown: 'outcome_unknown',
    cancelled: 'cancelled',
} as const;
export type StructureImportExecutionStatus =
    (typeof structureImportExecutionStatuses)[keyof typeof structureImportExecutionStatuses];

export const structureImportExecutionPhases = {
    queued: 'queued',
    preparing: 'preparing',
    create: 'create',
    update: 'update',
    delete: 'delete',
    channelOrder: 'channel_order',
    roleOrder: 'role_order',
    waitingRateLimit: 'waiting_rate_limit',
    paused: 'paused',
    verifying: 'verifying',
    complete: 'complete',
} as const;
export type StructureImportExecutionPhase =
    (typeof structureImportExecutionPhases)[keyof typeof structureImportExecutionPhases];

export const structureImportActionAttemptStates = {
    pending: 'pending',
    started: 'started',
    applied: 'applied',
    failed: 'failed',
    unknown: 'unknown',
} as const;

export type StructureImportPreflightRecord = {
    id: string;
    runId: string;
    planDigest: string;
    liveFingerprint: string;
    preflightDigest: string;
    report: Record<string, unknown>;
    status: 'ready' | 'blocked' | 'stale';
    checkedAt: Date;
    expiresAt: Date;
};

export type StructureImportApprovalRecord = {
    id: string;
    runId: string;
    planDigest: string;
    approvedByUserId: string | null;
    approvedAt: Date;
    deleteSetDigest: string | null;
    destructiveActionCount: number | null;
    destructiveApprovedAt: Date | null;
    destructivePreflightDigest: string | null;
};

export type StructureImportExecutionRecord = {
    id: string;
    runId: string;
    guildId: string;
    preflightDigest: string;
    protocolVersion: number;
    status: StructureImportExecutionStatus;
    nextActionSequence: number;
    notStartedActions: number;
    phase: StructureImportExecutionPhase;
    totalActions: number;
    totalMutationSteps: number;
    completedMutationSteps: number;
    appliedActions: number;
    failedActions: number;
    skippedActions: number;
    idMap: Record<string, string>;
    retryAt: Date | null;
    errorType: string | null;
    currentActionDomain: string | null;
    currentActionId: string | null;
    currentActionLabel: string | null;
    leaseId: string | null;
    leaseOwner: string | null;
    leaseExpiresAt: Date | null;
    heartbeatAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    controlRequest: 'pause' | 'cancel' | null;
    restorePointBackupId: string | null;
    verificationResult: Record<string, unknown> | null;
    verificationStatus: string | null;
    createdAt: Date;
    updatedAt: Date;
};

export type StructureImportActionAttemptRecord = {
    id: string;
    executionId: string;
    actionId: string;
    attempt: number;
    state: 'pending' | 'started' | 'applied' | 'failed' | 'unknown';
    requestKey: string;
    createdId: string | null;
    errorType: string | null;
    retryAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

export type StructureImportExecutionProtocolMismatchRecord = {
    executionId: string;
    executionProtocolVersion: number;
    guildId: string;
    kind: 'protocol_mismatch';
    mayHaveExternalEffects: boolean;
    requiredProtocolVersion: number;
    status: string;
};

export type StructureImportExecutionClaimRecord =
    | {
          kind: 'claimed';
          execution: StructureImportExecutionRecord;
          run: StructureImportRunRecord;
          actions: StructureImportActionRecord[];
          attempts: StructureImportActionAttemptRecord[];
      }
    | StructureImportExecutionProtocolMismatchRecord;

export type StructureImportDecisionRecord = {
    id: string;
    runId: string;
    sequence: number;
    targetType: string;
    classification: string;
    sourceId: string | null;
    targetId: string | null;
    logicalId: string | null;
    name: string | null;
    details: Record<string, unknown>;
    createdAt: Date;
};

export type StructureImportDecisionPageRecord = {
    decisions: StructureImportDecisionRecord[];
    nextCursor: number | null;
};

export type StructureImportActionRecord = {
    id: string;
    runId: string;
    sequence: number;
    actionType: string;
    targetType: string;
    targetId: string | null;
    details: Record<string, unknown>;
    createdAt: Date;
};

export type StructureImportActionPageRecord = {
    actions: StructureImportActionRecord[];
    nextCursor: string | null;
};

export type StructureImportExportRepositoryError = GuildFeatureRepositoryError | { type: 'backend-incompatible' };

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
