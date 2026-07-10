import type { GuildFeatureRepositoryError } from './contracts.js';

export const reactionRoleMessageModes = ['normal', 'exclusive'] as const;
export type ReactionRoleMessageMode = (typeof reactionRoleMessageModes)[number];

export const reactionRoleMessageSources = ['existing', 'dashboard'] as const;
export type ReactionRoleMessageSource = (typeof reactionRoleMessageSources)[number];

export type ReactionRoleMessageRecord = {
    channelId: string;
    createdAt: Date;
    enabled: boolean;
    generateOverview: boolean;
    guildId: string;
    id: string;
    kind: string;
    lifecycle: 'deleting' | 'needs_attention' | 'ready' | 'syncing';
    messageContent: string | null;
    messageEmbeds: unknown[];
    messageId: string;
    mode: ReactionRoleMessageMode;
    pendingOperationId: string | null;
    revision: number;
    source: ReactionRoleMessageSource;
    staleAt: Date | null;
    updatedAt: Date;
};

export type ReactionRoleOptionRecord = {
    createdAt: Date;
    emojiKey: string;
    id: string;
    position: number;
    reactionRoleMessageId: string;
    roleId: string;
    updatedAt: Date;
};

export type ReactionRoleAssignmentRecord = {
    assignedAt: Date;
    desiredState: 'absent' | 'present';
    emojiKey: string;
    guildId: string;
    id: string;
    messageId: string;
    reactionRoleMessageId: string | null;
    removedAt: Date | null;
    roleId: string;
    status: 'applied' | 'blocked' | 'pending';
    updatedAt: Date;
    userId: string;
};

export type ReactionRoleMessageWithOptions = ReactionRoleMessageRecord & {
    options: ReactionRoleOptionRecord[];
};

export type ReactionRoleOptionMatch = {
    message: ReactionRoleMessageRecord;
    option: ReactionRoleOptionRecord;
};

export type ReactionRoleOperationType = 'delete' | 'publish' | 'save';
export type ReactionRoleOperationStatus =
    | 'cancelled'
    | 'needs_attention'
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'waiting_retry';

type ReactionRoleDesiredOption = {
    emojiKey: string;
    position: number;
    roleId: string;
};

export type ReactionRoleDesiredConfig = {
    enabled: boolean;
    generateOverview: boolean;
    messageContent: string | null;
    messageEmbeds: unknown[];
    mode: ReactionRoleMessageMode;
    options: ReactionRoleDesiredOption[];
};

export type ReactionRoleOperationRecord = {
    actorUserId: string;
    attemptCount: number;
    blockedCount: number;
    channelId: string;
    completedAt: Date | null;
    createdAt: Date;
    desiredConfig: ReactionRoleDesiredConfig;
    errorCode: string | null;
    expectedRevision: number | null;
    externalMessageId: string | null;
    failureCount: number;
    guildId: string;
    id: string;
    idempotencyKey: string;
    leaseExpiresAt: Date | null;
    leaseId: string | null;
    leaseOwner: string | null;
    nextAttemptAt: Date | null;
    processedCount: number;
    reactionRoleMessageId: string | null;
    requestHash: string;
    sendStartedAt: Date | null;
    snapshotComplete: boolean;
    snapshotCursor: string | null;
    stage: string;
    status: ReactionRoleOperationStatus;
    succeededCount: number;
    totalCount: number;
    type: ReactionRoleOperationType;
    updatedAt: Date;
};

export type ReactionRoleOperationRequestResult =
    | { type: 'accepted' | 'existing'; operation: ReactionRoleOperationRecord }
    | { type: 'busy'; operation: ReactionRoleOperationRecord | null }
    | { type: 'idempotency-conflict' }
    | { type: 'not-found' }
    | { type: 'revision-conflict'; currentRevision: number };

export type ReactionRoleOperationRetryResult =
    | { type: 'queued'; operation: ReactionRoleOperationRecord }
    | { type: 'confirmation-required' | 'not-found' };

export type ReactionRoleReconciliationItemRecord = {
    assignmentId: string;
    attemptCount: number;
    createdAt: Date;
    emojiKey: string;
    errorCode: string | null;
    id: string;
    operationId: string;
    outcome: string | null;
    roleId: string;
    status: 'blocked' | 'pending' | 'succeeded';
    updatedAt: Date;
    userId: string;
};

export type ReactionRoleMemberStateRecord = {
    configRevision: number;
    createdAt: Date;
    desiredEmojiKeys: string[];
    errorCode: string | null;
    guildId: string;
    id: string;
    leaseExpiresAt: Date | null;
    leaseId: string | null;
    leaseOwner: string | null;
    messageId: string;
    nextAttemptAt: Date | null;
    reactionRoleMessageId: string;
    revision: number;
    status: 'blocked' | 'pending' | 'running' | 'synced' | 'waiting_retry';
    updatedAt: Date;
    userId: string;
};

export type ReactionRoleMemberTransitionResult =
    | { type: 'ignored' }
    | { type: 'queued'; state: ReactionRoleMemberStateRecord };

export type ReactionRoleMemberReconciliation = {
    assignments: ReactionRoleAssignmentRecord[];
    message: ReactionRoleMessageRecord;
    options: ReactionRoleOptionRecord[];
    state: ReactionRoleMemberStateRecord;
};

export type ReactionRoleMaintenanceResult = {
    assignmentsBackfilled: number;
    expiredUserLeasesDeleted: number;
    hasMore: boolean;
    messagesBackfilled: number;
    operationsDeleted: number;
    reconciliationItemsDeleted: number;
    removedAssignmentsDeleted: number;
};

export type ReactionRolesRepositoryError = GuildFeatureRepositoryError;
