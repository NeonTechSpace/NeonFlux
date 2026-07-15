import type { GuildFeatureRepositoryError } from './contracts.js';

export const BLUEPRINT_FEATURE = 'blueprint';

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

export const blueprintPlanStatuses = {
    draft: 'draft',
    needsInput: 'needs_input',
    reviewReady: 'review_ready',
    approved: 'approved',
    obsolete: 'obsolete',
} as const;

export const blueprintAuditActions = {
    backupCreated: 'blueprint.backup_created',
    backupDeleted: 'blueprint.backup_deleted',
    backupFailed: 'blueprint.backup_failed',
    backupImportCreated: 'blueprint.backup_import_created',
    backupRenamed: 'blueprint.backup_renamed',
    backupRestorePointCreated: 'blueprint.backup_restore_point_created',
    backupRetentionPruned: 'blueprint.backup_retention_pruned',
    backupSettingsUpdated: 'blueprint.backup_settings_updated',
    planCreated: 'blueprint.plan_created',
    planApproved: 'blueprint.plan_approved',
    preflightChecked: 'blueprint.preflight_checked',
    runQueued: 'blueprint.run_queued',
    runSucceeded: 'blueprint.run_succeeded',
    runPartiallyApplied: 'blueprint.run_partially_applied',
    runNeedsReconciliation: 'blueprint.run_needs_reconciliation',
    runOutcomeUnknown: 'blueprint.run_outcome_unknown',
    runPaused: 'blueprint.run_paused',
    runPauseRequested: 'blueprint.run_pause_requested',
    runResumed: 'blueprint.run_resumed',
    runCancelled: 'blueprint.run_cancelled',
    runCancelRequested: 'blueprint.run_cancel_requested',
    scheduledDriftDetected: 'blueprint.scheduled_drift_detected',
    scheduledDriftFailed: 'blueprint.scheduled_drift_failed',
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

export type BlueprintPlanRecord = {
    id: string;
    guildId: string;
    deleteStepCount: number;
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

export const blueprintRunStatuses = {
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
export type BlueprintRunStatus = (typeof blueprintRunStatuses)[keyof typeof blueprintRunStatuses];

export const blueprintRunPhases = {
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
export type BlueprintRunPhase = (typeof blueprintRunPhases)[keyof typeof blueprintRunPhases];

export const blueprintRunStepAttemptStates = {
    pending: 'pending',
    started: 'started',
    applied: 'applied',
    failed: 'failed',
    unknown: 'unknown',
} as const;

export type BlueprintPlanPreflightRecord = {
    id: string;
    planId: string;
    planDigest: string;
    fingerprintVersion: 2;
    structureFingerprint: string;
    capabilityFingerprint: string;
    mutationFenceManifestJson: string;
    observedAt: Date;
    observationSource: 'resident-client';
    preflightDigest: string;
    report: Record<string, unknown>;
    status: 'ready' | 'blocked' | 'stale';
    checkedAt: Date;
    expiresAt: Date;
};

export type BlueprintPlanApprovalRecord = {
    id: string;
    planId: string;
    planDigest: string;
    approvedByUserId: string | null;
    approvedAt: Date;
    deleteSetDigest: string | null;
    destructiveStepCount: number | null;
    destructiveApprovedAt: Date | null;
    destructivePreflightDigest: string | null;
    fingerprintVersion: 2 | null;
    approvedStructureFingerprint: string | null;
    approvedCapabilityFingerprint: string | null;
    confirmationMethod: 'acknowledgement' | 'target_name' | null;
};

export type BlueprintRunRecord = {
    id: string;
    planId: string;
    guildId: string;
    preflightDigest: string;
    preflightExpiresAt: Date;
    fingerprintVersion: 2;
    expectedStructureFingerprint: string;
    expectedCapabilityFingerprint: string;
    authorizationDecision:
        | 'authorized'
        | 'structure_changed'
        | 'capability_changed'
        | 'structure_and_capability_changed'
        | 'restore_observation_diverged'
        | 'preflight_expired'
        | 'fingerprint_version_mismatch'
        | null;
    authorizationMismatch: Record<string, unknown> | null;
    mutationAuthorizedAt: Date | null;
    mutationAuthorizationLeaseId: string | null;
    protocolVersion: number;
    status: BlueprintRunStatus;
    nextStepSequence: number;
    notStartedSteps: number;
    phase: BlueprintRunPhase;
    totalSteps: number;
    totalMutationSteps: number;
    completedMutationSteps: number;
    appliedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    idMap: Record<string, string>;
    retryAt: Date | null;
    errorType: string | null;
    currentStepDomain: string | null;
    currentStepId: string | null;
    currentStepLabel: string | null;
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

export type BlueprintRunMutationAuthorizationRecord =
    | { kind: 'authorized' | 'not_required'; run: BlueprintRunRecord }
    | {
          kind: 'rejected';
          reason:
              | 'preflight_expired'
              | 'structure_changed'
              | 'capability_changed'
              | 'structure_and_capability_changed'
              | 'restore_observation_diverged'
              | 'fingerprint_version_mismatch';
          run: BlueprintRunRecord;
      };

export type BlueprintRunStepAttemptRecord = {
    id: string;
    runId: string;
    planStepId: string;
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

export type BlueprintRunProtocolMismatchRecord = {
    runId: string;
    runProtocolVersion: number;
    guildId: string;
    kind: 'protocol_mismatch';
    mayHaveExternalEffects: boolean;
    requiredProtocolVersion: number;
    status: string;
};

export type BlueprintRunClaimRecord =
    | {
          kind: 'claimed';
          run: BlueprintRunRecord;
          plan: BlueprintPlanRecord;
          steps: BlueprintPlanStepRecord[];
          attempts: BlueprintRunStepAttemptRecord[];
      }
    | BlueprintRunProtocolMismatchRecord;

export type BlueprintPlanDecisionRecord = {
    id: string;
    planId: string;
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

export type BlueprintPlanDecisionPageRecord = {
    decisions: BlueprintPlanDecisionRecord[];
    nextCursor: number | null;
};

export type BlueprintPlanStepRecord = {
    id: string;
    planId: string;
    sequence: number;
    actionType: string;
    targetType: string;
    targetId: string | null;
    details: Record<string, unknown>;
    createdAt: Date;
};

export type BlueprintPlanStepPageRecord = {
    steps: BlueprintPlanStepRecord[];
    nextCursor: string | null;
};

export type BlueprintRepositoryError =
    | GuildFeatureRepositoryError
    | { type: 'backend-incompatible' }
    | { type: 'blueprint-restore-point-recovery-window-active' }
    | { type: 'blueprint-restore-point-run-active' }
    | { type: 'blueprint-run-review-stale' }
    | { type: 'blueprint-guild-run-active' }
    | { type: 'blueprint-run-empty' };

export type BlueprintPlanWithStepsRecord = BlueprintPlanRecord & {
    steps: BlueprintPlanStepRecord[];
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
