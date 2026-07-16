import type {
    DashboardBlueprintPlan as DashboardBlueprintDiffPlan,
    DashboardBlueprintSnapshot,
} from './dashboard-blueprint-diff.js';
import type {
    DashboardBlueprintDecisionSummary,
    DashboardBlueprintRunProgress,
    DashboardBlueprintPlanPreflight,
    DashboardBlueprintPolicy,
    DashboardBlueprintPlanDecision,
} from './dashboard-blueprint-contracts.js';

export type DashboardBlueprintErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'backend-incompatible' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type DashboardBlueprintJsonValue =
    | string
    | number
    | boolean
    | null
    | DashboardBlueprintJsonValue[]
    | { [key: string]: DashboardBlueprintJsonValue };

export type DashboardBlueprintJsonRecord = {
    [key: string]: DashboardBlueprintJsonValue;
};

export type DashboardBlueprintBackupSummary = {
    id: string;
    name: string;
    source: string;
    status: string;
    errorMessage?: string;
    createdByUserId?: string;
    createdAt: string;
    completedAt: string;
    roleCount: number;
    categoryCount: number;
    channelCount: number;
};

export type DashboardBlueprintDriftFieldSummary = {
    names: number;
    parentMoves: number;
    permissions: number;
    positions: number;
    roleVisuals: number;
    typeChanges: number;
};

export type DashboardBlueprintScheduledDriftStatus = {
    status: string;
    checkedAt?: string;
    nextCheckAt?: string;
    errorMessage?: string;
    changeCount?: number;
    baselineBackupId?: string;
    baselineName?: string;
    summary?: DashboardBlueprintDiffPlan['summary'];
    fieldSummary?: DashboardBlueprintDriftFieldSummary;
    liveCounts?: { categories: number; channels: number; roles: number };
    hasMorePreview: boolean;
};

export type DashboardBlueprintBackupSettings = {
    enabled: boolean;
    cadenceWeeks: number;
    retentionDays: number;
    lastAttemptAt?: string;
    lastSuccessAt?: string;
    lastErrorMessage?: string;
    nextBackupAt?: string;
    nextDriftCheckAt?: string;
    nextRetentionPruneAt?: string;
    scheduledDrift?: DashboardBlueprintScheduledDriftStatus;
};

export type DashboardBlueprintPlanStep = {
    id: string;
    sequence: number;
    actionType: string;
    targetType: string;
    targetId?: string;
    label?: string;
    details: DashboardBlueprintJsonRecord;
};

export type DashboardBlueprintVerification = {
    status: 'matched' | 'mismatch' | 'read-failed';
    verifiedAt: string;
    expectedStructureDigest?: string;
    actualStructureDigest?: string;
    failureReason?: string;
};

export type DashboardBlueprintPlan = {
    id: string;
    status: string;
    createdByUserId?: string;
    createdAt: string;
    updatedAt: string;
    summary: DashboardBlueprintDiffPlan['summary'];
    changeCount: number;
    planStepCount: number;
    planBlockerCount: number;
    steps: DashboardBlueprintPlanStep[];
    requestedSnapshot?: DashboardBlueprintSnapshot;
    requestedSnapshotStoredAt?: string;
    recoveryAvailable?: boolean;
    verification?: DashboardBlueprintVerification;
    policy: DashboardBlueprintPolicy;
    decisionSummary: DashboardBlueprintDecisionSummary;
    decisions: DashboardBlueprintPlanDecision[];
    planDigest: string;
    deleteStepCount: number;
    deleteSetDigest?: string;
    preflight?: DashboardBlueprintPlanPreflight;
    run?: DashboardBlueprintRunProgress;
};

export type DashboardBlueprintPlanColdDetail = {
    id: string;
    requestedSnapshot?: DashboardBlueprintSnapshot;
    requestedSnapshotStoredAt?: string;
};

type DashboardBlueprintPlanStepPage = {
    steps: DashboardBlueprintPlanStep[];
    nextCursor?: string;
};

export type DashboardBlueprintDriftInput = {
    baselineBackupId?: string;
    guildId: string;
};

export type DashboardBlueprintDriftPreviewAction = {
    id: string;
    sequence: number;
    actionType: string;
    targetType: string;
    targetId?: string;
    label?: string;
    fields: string[];
    details: DashboardBlueprintJsonRecord;
};

export type DashboardBlueprintDriftResult =
    | {
          type: 'structure-drift';
          baseline: DashboardBlueprintBackupSummary;
          checkedAt: string;
          fieldSummary: DashboardBlueprintDriftFieldSummary;
          hasMorePreview: boolean;
          liveCounts: { categories: number; channels: number; roles: number };
          previewActions: DashboardBlueprintDriftPreviewAction[];
          summary: DashboardBlueprintDiffPlan['summary'];
      }
    | { type: 'no-baseline' }
    | { type: 'backup-json-unavailable' }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintObservedState = {
    observedChangeCount: number;
    targetChangeCounts: Record<string, number>;
    changedSinceLastBackup: boolean;
    lastEventType?: string;
    lastTargetType?: string;
    lastTargetId?: string;
    lastObservedAt?: string;
};

export type DashboardBlueprintStatusResult =
    | { type: 'status'; activePlan?: Pick<DashboardBlueprintPlan, 'id' | 'run'> }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintBackupsResult =
    | {
          type: 'backups';
          backups: DashboardBlueprintBackupSummary[];
          backupNextCursor?: string;
          backupSettings: DashboardBlueprintBackupSettings;
          observedState: DashboardBlueprintObservedState;
      }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintRunsResult =
    | { type: 'runs'; plans: DashboardBlueprintPlan[]; targetGuildName: string }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintBackupResult =
    | { type: 'backup-created'; backup: DashboardBlueprintBackupSummary; backupJson: string }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintCurrentExportResult =
    | { type: 'structure-export-created'; fileName: string; structureJson: string }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintBackupJsonResult =
    | { type: 'backup-json'; backupId: string; fileName: string; backupJson: string }
    | { type: 'backup-json-unavailable' }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintBackupPageInput = { cursor?: string; guildId: string; limit?: number };
export type DashboardBlueprintBackupPage = { backups: DashboardBlueprintBackupSummary[]; nextCursor?: string };
export type DashboardBlueprintBackupPageResult =
    | { type: 'backup-page'; page: DashboardBlueprintBackupPage }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintBackupRenameInput = { backupId: string; guildId: string; name: string };
export type DashboardBlueprintBackupRenameResult =
    | { type: 'backup-renamed'; backup: DashboardBlueprintBackupSummary }
    | { type: 'invalid-input'; message: string }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintBackupDeleteInput = { backupId: string; guildId: string };
export type DashboardBlueprintBackupDeleteResult =
    | { type: 'backup-deleted'; backupId: string }
    | { type: 'invalid-input'; message: string }
    | { type: 'restore-point-recovery-window-active' }
    | { type: 'restore-point-run-active' }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintBackupImportInput = { backupId: string; guildId: string };
export type DashboardBlueprintBackupImportResult =
    | { type: 'backup-import-created'; plan: DashboardBlueprintPlan }
    | { type: 'backup-json-unavailable' }
    | { type: 'bot-token-missing' }
    | { type: 'invalid-input'; message: string }
    | { type: 'mapping-required'; conflicts: DashboardBlueprintRoleMappingConflict[] }
    | { type: 'structure-read-failed' }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintBackupSettingsInput = {
    cadenceWeeks: number;
    enabled: boolean;
    guildId: string;
    retentionDays: number;
};
export type DashboardBlueprintBackupSettingsResult =
    | { type: 'backup-settings-saved'; backupSettings: DashboardBlueprintBackupSettings }
    | { type: 'invalid-input'; message: string }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintPlanResult =
    | { type: 'plan-created'; plan: DashboardBlueprintPlan }
    | { type: 'invalid-input'; message: string }
    | { type: 'mapping-required'; conflicts: DashboardBlueprintRoleMappingConflict[] }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintPlanInput = {
    guildId: string;
    backupJson: string;
    policy: DashboardBlueprintPolicy;
    roleMappings?: Record<string, string>;
    categoryMappings?: Record<string, string>;
    channelMappings?: Record<string, string>;
};

export type DashboardBlueprintRoleMappingConflict = {
    targetType: 'role' | 'category' | 'channel';
    name: string;
    sourceIds: string[];
    candidateTargetIds: string[];
};

export type DashboardBlueprintApprovalInput = { guildId: string; planId: string; planDigest: string };
export type DashboardBlueprintApprovalResult =
    | { type: 'approved'; plan: DashboardBlueprintPlan }
    | { type: 'invalid-input'; message: string }
    | { type: 'plan-digest-mismatch' }
    | { type: 'not-approvable'; status: string }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintRecoveryInput = { guildId: string; planId: string };
export type DashboardBlueprintRecoveryResult =
    | { type: 'recovery-plan-created'; plan: DashboardBlueprintPlan }
    | { type: 'invalid-input'; message: string }
    | { type: 'mapping-required'; conflicts: DashboardBlueprintRoleMappingConflict[] }
    | { type: 'not-recoverable'; status: string }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardBlueprintErrorResult;

export type DashboardBlueprintPlanStepPageInput = {
    cursor?: string;
    guildId: string;
    planId: string;
    limit?: number;
};
export type DashboardBlueprintPlanStepPageResult =
    | { type: 'plan-step-page'; page: DashboardBlueprintPlanStepPage }
    | { type: 'invalid-input'; message: string }
    | DashboardBlueprintErrorResult;
