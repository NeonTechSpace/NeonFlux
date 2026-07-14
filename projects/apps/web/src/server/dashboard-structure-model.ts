import type { DashboardStructurePlan, DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import type { DashboardStructurePreflightReport } from './dashboard-structure-preflight.js';
import type {
    DashboardStructureDecisionSummary,
    DashboardStructureExecutionProgress,
    DashboardStructurePersistedPreflight,
    DashboardStructurePolicy,
    DashboardStructureReviewDecision,
} from './dashboard-structure-contracts.js';

export type DashboardStructureErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'backend-incompatible' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type DashboardStructureJsonValue =
    | string
    | number
    | boolean
    | null
    | DashboardStructureJsonValue[]
    | { [key: string]: DashboardStructureJsonValue };

export type DashboardStructureJsonRecord = {
    [key: string]: DashboardStructureJsonValue;
};

export type DashboardStructureBackupSummary = {
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

export type DashboardStructureDriftFieldSummary = {
    names: number;
    parentMoves: number;
    permissions: number;
    positions: number;
    roleVisuals: number;
    typeChanges: number;
};

export type DashboardStructureScheduledDriftStatus = {
    status: string;
    checkedAt?: string;
    nextCheckAt?: string;
    errorMessage?: string;
    changeCount?: number;
    baselineBackupId?: string;
    baselineName?: string;
    summary?: DashboardStructurePlan['summary'];
    fieldSummary?: DashboardStructureDriftFieldSummary;
    liveCounts?: { categories: number; channels: number; roles: number };
    hasMorePreview: boolean;
};

export type DashboardStructureBackupSettings = {
    enabled: boolean;
    cadenceWeeks: number;
    retentionDays: number;
    lastAttemptAt?: string;
    lastSuccessAt?: string;
    lastErrorMessage?: string;
    nextBackupAt?: string;
    nextDriftCheckAt?: string;
    nextRetentionPruneAt?: string;
    scheduledDrift?: DashboardStructureScheduledDriftStatus;
};

export type DashboardStructureImportAction = {
    id: string;
    sequence: number;
    actionType: string;
    targetType: string;
    targetId?: string;
    label?: string;
    details: DashboardStructureJsonRecord;
};

type DashboardStructureVerification = {
    status: 'matched' | 'mismatch' | 'read-failed';
    verifiedAt: string;
    mismatchCount: number;
    preview: Array<{
        logicalId: string;
        field: string;
        expected?: DashboardStructureJsonValue;
        actual?: DashboardStructureJsonValue;
    }>;
};

export type DashboardStructureImportRun = {
    id: string;
    status: string;
    createdByUserId?: string;
    createdAt: string;
    updatedAt: string;
    summary: DashboardStructurePlan['summary'];
    actionCount: number;
    executionActionCount: number;
    planBlockerCount: number;
    actions: DashboardStructureImportAction[];
    requestedSnapshot?: DashboardStructureSnapshot;
    requestedSnapshotStoredAt?: string;
    recoveryAvailable?: boolean;
    verification?: DashboardStructureVerification;
    policy: DashboardStructurePolicy;
    decisionSummary: DashboardStructureDecisionSummary;
    decisions: DashboardStructureReviewDecision[];
    planDigest: string;
    deleteActionCount: number;
    deleteSetDigest?: string;
    preflight?: DashboardStructurePersistedPreflight & { report: DashboardStructurePreflightReport };
    execution?: DashboardStructureExecutionProgress;
};

type DashboardStructureImportActionPage = {
    actions: DashboardStructureImportAction[];
    nextCursor?: string;
};

export type DashboardStructureDriftInput = {
    baselineBackupId?: string;
    guildId: string;
};

export type DashboardStructureDriftPreviewAction = {
    id: string;
    sequence: number;
    actionType: string;
    targetType: string;
    targetId?: string;
    label?: string;
    fields: string[];
    details: DashboardStructureJsonRecord;
};

export type DashboardStructureDriftResult =
    | {
          type: 'structure-drift';
          baseline: DashboardStructureBackupSummary;
          checkedAt: string;
          fieldSummary: DashboardStructureDriftFieldSummary;
          hasMorePreview: boolean;
          liveCounts: { categories: number; channels: number; roles: number };
          previewActions: DashboardStructureDriftPreviewAction[];
          summary: DashboardStructurePlan['summary'];
      }
    | { type: 'no-baseline' }
    | { type: 'backup-json-unavailable' }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

export type DashboardStructureObservedState = {
    observedChangeCount: number;
    targetChangeCounts: Record<string, number>;
    changedSinceLastBackup: boolean;
    lastEventType?: string;
    lastTargetType?: string;
    lastTargetId?: string;
    lastObservedAt?: string;
};

export type DashboardStructureStatusResult =
    | { type: 'status'; activeRun?: Pick<DashboardStructureImportRun, 'id' | 'execution'> }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupsResult =
    | {
          type: 'backups';
          backups: DashboardStructureBackupSummary[];
          backupNextCursor?: string;
          backupSettings: DashboardStructureBackupSettings;
          observedState: DashboardStructureObservedState;
      }
    | DashboardStructureErrorResult;

export type DashboardStructureRunsResult =
    | { type: 'runs'; importRuns: DashboardStructureImportRun[] }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupResult =
    | { type: 'backup-created'; backup: DashboardStructureBackupSummary; backupJson: string }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

export type DashboardStructureCurrentExportResult =
    | { type: 'structure-export-created'; fileName: string; structureJson: string }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupJsonResult =
    | { type: 'backup-json'; backupId: string; fileName: string; backupJson: string }
    | { type: 'backup-json-unavailable' }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupPageInput = { cursor?: string; guildId: string; limit?: number };
export type DashboardStructureBackupPage = { backups: DashboardStructureBackupSummary[]; nextCursor?: string };
export type DashboardStructureBackupPageResult =
    | { type: 'backup-page'; page: DashboardStructureBackupPage }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupRenameInput = { backupId: string; guildId: string; name: string };
export type DashboardStructureBackupRenameResult =
    | { type: 'backup-renamed'; backup: DashboardStructureBackupSummary }
    | { type: 'invalid-input'; message: string }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupDeleteInput = { backupId: string; guildId: string };
export type DashboardStructureBackupDeleteResult =
    | { type: 'backup-deleted'; backupId: string }
    | { type: 'invalid-input'; message: string }
    | { type: 'restore-point-protected' }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupImportInput = { backupId: string; guildId: string };
export type DashboardStructureBackupImportResult =
    | { type: 'backup-import-created'; importRun: DashboardStructureImportRun }
    | { type: 'backup-json-unavailable' }
    | { type: 'bot-token-missing' }
    | { type: 'invalid-input'; message: string }
    | { type: 'mapping-required'; conflicts: DashboardStructureRoleMappingConflict[] }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

export type DashboardStructureBackupSettingsInput = {
    cadenceWeeks: number;
    enabled: boolean;
    guildId: string;
    retentionDays: number;
};
export type DashboardStructureBackupSettingsResult =
    | { type: 'backup-settings-saved'; backupSettings: DashboardStructureBackupSettings }
    | { type: 'invalid-input'; message: string }
    | DashboardStructureErrorResult;

export type DashboardStructurePlanResult =
    | { type: 'plan-created'; importRun: DashboardStructureImportRun }
    | { type: 'invalid-input'; message: string }
    | { type: 'mapping-required'; conflicts: DashboardStructureRoleMappingConflict[] }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

export type DashboardStructurePlanInput = {
    guildId: string;
    backupJson: string;
    policy: DashboardStructurePolicy;
    roleMappings?: Record<string, string>;
    categoryMappings?: Record<string, string>;
    channelMappings?: Record<string, string>;
};

export type DashboardStructureRoleMappingConflict = {
    targetType: 'role' | 'category' | 'channel';
    name: string;
    sourceIds: string[];
    candidateTargetIds: string[];
};

export type DashboardStructureApprovalInput = { guildId: string; importRunId: string; planDigest: string };
export type DashboardStructureApprovalResult =
    | { type: 'approved'; importRun: DashboardStructureImportRun }
    | { type: 'invalid-input'; message: string }
    | { type: 'plan-digest-mismatch' }
    | { type: 'not-approvable'; status: string }
    | DashboardStructureErrorResult;

export type DashboardStructureRecoveryInput = { guildId: string; importRunId: string };
export type DashboardStructureRecoveryResult =
    | { type: 'recovery-plan-created'; importRun: DashboardStructureImportRun }
    | { type: 'invalid-input'; message: string }
    | { type: 'mapping-required'; conflicts: DashboardStructureRoleMappingConflict[] }
    | { type: 'not-recoverable'; status: string }
    | { type: 'bot-token-missing' }
    | { type: 'structure-read-failed' }
    | DashboardStructureErrorResult;

export type DashboardStructureActionPageInput = {
    cursor?: string;
    guildId: string;
    importRunId: string;
    limit?: number;
};
export type DashboardStructureActionPageResult =
    | { type: 'action-page'; page: DashboardStructureImportActionPage }
    | { type: 'invalid-input'; message: string }
    | DashboardStructureErrorResult;
