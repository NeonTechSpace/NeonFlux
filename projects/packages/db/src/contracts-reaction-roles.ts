import type {
    ReactionRoleEmoji,
    ReactionRoleMode,
    ReactionRoleOption,
    ReactionRolePanelDraft,
} from '@neonflux/reaction-roles';

export type ReactionRolePanelStatus =
    | 'publishing'
    | 'active'
    | 'updating'
    | 'deactivating'
    | 'degraded'
    | 'unknown'
    | 'inactive';

export type ReactionRolePanelOperationStatus = 'queued' | 'running' | 'unknown' | 'completed' | 'permanent_failure';
export type ReactionRolePanelOperationType = 'publish' | 'update' | 'deactivate';
export type ReactionRolePanelOperationStep =
    | 'queued'
    | 'message_send_started'
    | 'message_recorded'
    | 'reactions_seeded'
    | 'message_updated'
    | 'cleanup_started'
    | 'cleanup_completed'
    | 'completed';

export type ReactionRoleStoredOption = ReactionRoleOption & {
    emojiKey: string;
};

export type ReactionRoleVersionRecord = {
    createdAt: Date;
    fingerprint: string;
    id: string;
    payload: Omit<ReactionRolePanelDraft, 'options'> & { options: ReactionRoleStoredOption[] };
    version: number;
};

export type ReactionRolePanelRecord = {
    appliedVersionId: string | null;
    channelId: string;
    createdAt: Date;
    desiredVersion: ReactionRoleVersionRecord;
    errorCode: string | null;
    generation: number;
    guildId: string;
    id: string;
    messageId: string | null;
    mode: ReactionRoleMode;
    name: string;
    status: ReactionRolePanelStatus;
    updatedAt: Date;
};

export type ReactionRolePanelOperationRecord = {
    attemptCount: number;
    createdAt: Date;
    errorCode: string | null;
    id: string;
    messageId: string | null;
    nextAttemptAt: Date | null;
    panelId: string;
    status: ReactionRolePanelOperationStatus;
    step: ReactionRolePanelOperationStep;
    type: ReactionRolePanelOperationType;
    updatedAt: Date;
};

export type ReactionRolePanelMutationRecord = {
    operation: ReactionRolePanelOperationRecord;
    panel: ReactionRolePanelRecord;
};

export type ReactionRolePanelWorkerRecord = ReactionRolePanelOperationRecord & {
    channelId: string;
    deleteMessage: boolean;
    generation: number;
    guildId: string;
    leaseExpiresAt: Date | null;
    leaseId: string | null;
    leaseOwner: string | null;
    nonce: string;
    previousVersion: ReactionRoleVersionRecord | null;
    revokeOwnedRoles: boolean;
    targetVersion: ReactionRoleVersionRecord;
};

export type ReactionRoleSelectionSnapshot = {
    emoji: ReactionRoleEmoji;
    grantOwnership: 'panel' | 'preexisting' | 'pending';
    optionId: string;
    roleId: string;
};

export type ReactionRoleMemberWorkerRecord = {
    addedOptionIds: string[];
    attemptCount: number;
    baselineRoleIds: string[] | null;
    channelId: string;
    createdAt: Date;
    desiredSelections: ReactionRoleSelectionSnapshot[];
    errorCode: string | null;
    guildId: string;
    id: string;
    leaseExpiresAt: Date | null;
    leaseId: string | null;
    leaseOwner: string | null;
    messageId: string | null;
    nextAttemptAt: Date | null;
    panelGeneration: number;
    panelId: string;
    previousSelections: ReactionRoleSelectionSnapshot[];
    rerunRequested: boolean;
    revision: number;
    status: 'queued' | 'running' | 'completed' | 'permanent_failure';
    updatedAt: Date;
    userId: string;
};

export type ReactionRoleIntentResult =
    | { type: 'ignored' | 'unconfigured' }
    | { emoji: ReactionRoleEmoji; type: 'seed-repair' }
    | { operationId: string; revision: number; type: 'enqueued' };

export type ReactionRoleExecutionPolicy = {
    botInstalled: boolean;
    storedDefconLevel: 1 | 2 | 3 | null;
};

export type ReactionRoleRepositoryError =
    | { field: 'requestKey' | 'roleId' | 'updatedAt'; type: 'conflict' }
    | { field: string; type: 'invalid-value' | 'missing-input' }
    | { type: 'database-error' | 'not-found' | 'not-runnable' };
