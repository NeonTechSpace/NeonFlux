import type {
    BlueprintPlanAuthorityV1,
    BlueprintPlanDecision,
    BlueprintPlanExecutionAuthorityV1,
    BlueprintPlanStep,
    BlueprintPlanSummary,
    BlueprintPreflightEvidenceV1,
    BlueprintPreflightReportSummary,
    BlueprintRunCursorV1,
    BlueprintRunVerificationEvidenceV1,
} from '@neonflux/blueprint';

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

export type StructureBackupSettingsPageRecord = {
    nextCursor: string | null;
    settings: StructureBackupSettingsRecord[];
};

export type StructureBackupRetentionPruneRecord = {
    deletedCount: number;
    hasMore: boolean;
    nextRetentionPruneAt: Date | null;
};

export type BlueprintPlanDecisionSummaryRecord = {
    noOp: number;
    create: number;
    update: number;
    delete: number;
    protectedRetained: number;
    protectedOmitted: number;
    unmanagedRetained: number;
    blockedAmbiguous: number;
    blockedUnsupported: number;
};

export type BlueprintPlanMetadataRecord = {
    id: string;
    guildId: string;
    sourceBackupId: string | null;
    status: 'draft' | 'needs_input' | 'review_ready' | 'approved' | 'obsolete';
    policy: 'merge' | 'synchronize' | 'rebuild';
    planVersion: 4;
    summary: BlueprintPlanSummary;
    decisionSummary: BlueprintPlanDecisionSummaryRecord;
    blockerCount: number;
    requestedSnapshotDigest: string;
    projectedSnapshotDigest: string;
    authorityVersion: 1;
    authorityDigest: string;
    executionAuthorityVersion: 1;
    executionAuthorityDigest: string;
    stepCount: number;
    stepLedgerDigest: string;
    decisionCount: number;
    decisionLedgerDigest: string;
    deleteStepCount: number;
    deleteSetDigest: string | null;
    planDigest: string;
    createdByUserId: string | null;
    createdAt: Date;
    sealedAt?: Date | null;
    updatedAt: Date;
};

/** A deliberately cold, immutable plan-owned authority record. */
export type BlueprintPlanAuthorityRecord = Omit<BlueprintPlanAuthorityV1, 'createdAt'> & {
    id: string;
    createdAt: Date;
};

/** A bounded immutable projection used by per-step execution paths. */
export type BlueprintPlanExecutionAuthorityRecord = Omit<BlueprintPlanExecutionAuthorityV1, 'createdAt'> & {
    id: string;
    createdAt: Date;
};

/** List/history DTO. It intentionally contains metadata only. */
export type BlueprintPlanSummaryRecord = BlueprintPlanMetadataRecord;

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

export type BlueprintPlanPreflightMetadataRecord = {
    id: string;
    planId: string;
    guildId: string;
    status: 'ready' | 'blocked' | 'stale';
    summary: BlueprintPreflightReportSummary;
    checkedAt: Date;
    observedAt: Date;
    expiresAt: Date;
    observationSource: 'resident-client';
    planDigest: string;
    fingerprintVersion: 2;
    structureFingerprint: string;
    capabilityFingerprint: string;
    evidenceVersion: 1;
    evidenceDigest: string;
    preflightDigest: string;
};

/** List/history DTO. It intentionally excludes the report and mutation-fence manifest. */
export type BlueprintPlanPreflightSummaryRecord = BlueprintPlanPreflightMetadataRecord;

export type BlueprintPlanPreflightEvidenceRecord = Omit<BlueprintPreflightEvidenceV1, 'createdAt'> & {
    id: string;
    createdAt: Date;
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
    preflightId: string;
    preflightDigest: string;
    preflightExpiresAt: Date;
    fingerprintVersion: 2;
    expectedStructureFingerprint: string;
    expectedCapabilityFingerprint: string;
    executionAuthorityDigest: string;
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
    restorePointSnapshotDigest: string | null;
    verificationStatus: 'matched' | 'mismatch' | 'read_failed' | null;
    verificationEvidenceVersion: 1 | null;
    verificationEvidenceDigest: string | null;
    terminalDigest: string | null;
    terminalRequestDigest: string | null;
    createdAt: Date;
    updatedAt: Date;
};

/** List/history DTO. It intentionally excludes cursor and verification evidence. */
export type BlueprintRunSummaryRecord = BlueprintRunRecord;

export type BlueprintRunCursorRecord = Omit<BlueprintRunCursorV1, 'updatedAt'> & {
    id: string;
    updatedAt: Date;
};

export type BlueprintRunVerificationEvidenceRecord = Omit<BlueprintRunVerificationEvidenceV1, 'createdAt'> & {
    id: string;
    createdAt: Date;
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
    planStepSequence: number;
    stepDigest: string;
    actionType: 'create' | 'update' | 'delete';
    targetType: 'role' | 'category' | 'channel' | 'role-order' | 'channel-order';
    targetId: string;
    sourceId: string | null;
    displayLabel: string;
    attempt: number;
    state: 'pending' | 'started' | 'applied' | 'failed' | 'unknown';
    requestKey: string;
    completionDigest: string | null;
    createdId: string | null;
    errorType: string | null;
    retryAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

export type BlueprintRunStepPreparationRecord = {
    kind: 'prepared' | 'control_requested';
    attempt: BlueprintRunStepAttemptRecord;
    run: BlueprintRunRecord;
};

export type BlueprintRunStepStartRecord = {
    kind: 'started' | 'control_requested';
    attempt: BlueprintRunStepAttemptRecord;
    run: BlueprintRunRecord;
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
          cursor: BlueprintRunCursorRecord;
          plan: BlueprintPlanMetadataRecord;
          authority: BlueprintPlanAuthorityRecord;
          executionAuthority: BlueprintPlanExecutionAuthorityRecord;
          steps: BlueprintPlanStepRecord[];
          decisions: BlueprintPlanDecisionRecord[];
          attempts: BlueprintRunStepAttemptRecord[];
      }
    | BlueprintRunProtocolMismatchRecord
    | {
          kind: 'authority_invalid';
          errorType: string;
          guildId: string;
          mayHaveExternalEffects: boolean;
          runId: string;
          status: 'failed_before_mutation' | 'partially_applied';
      };

export type BlueprintPlanDecisionRecord = {
    id: string;
    planId: string;
    sequence: number;
    decision: BlueprintPlanDecision;
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
    step: BlueprintPlanStep;
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
    | { type: 'blueprint-run-empty' }
    | { type: 'blueprint-plan-too-large' };

export type BlueprintPlanDetailRecord = {
    plan: BlueprintPlanMetadataRecord;
    authority: BlueprintPlanAuthorityRecord;
    steps: BlueprintPlanStepRecord[];
    decisions: BlueprintPlanDecisionRecord[];
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
