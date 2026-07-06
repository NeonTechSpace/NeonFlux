import type { ServerLogEventGroup } from '@neonflux/core/server-event-logging';

export type DeploymentConfigRecord =
    | {
          instanceMode: 'single';
          ownerIds: string[];
          publicWebUrl: string | null;
          singleGuildId: string;
      }
    | {
          instanceMode: 'multi';
          ownerIds: string[];
          publicWebUrl: string | null;
      };

export type DeploymentConfigInput = {
    instanceMode: string | null | undefined;
    ownerIds?: readonly string[];
    publicWebUrl?: string | null;
    singleGuildId?: string | null;
};

export type DeploymentConfigRepositoryError =
    | 'missing-instance-mode'
    | 'invalid-instance-mode'
    | 'missing-single-guild-id'
    | 'not-found'
    | 'database-error';

export type BotInstallationRecord = {
    guildId: string;
    installedAt: Date;
    updatedAt: Date;
};

export type BotInstallationRepositoryError = 'missing-guild-id' | 'not-found' | 'database-error';

export type GuildDefconLevel = 1 | 2 | 3;

export type GuildSecurityPolicyRecord = {
    createdAt: Date;
    defconLevel: GuildDefconLevel;
    guildId: string;
    updatedAt: Date;
};

export type GuildDefconExemptionRecord = {
    category: string;
    createdAt: Date;
    guildId: string;
};

export type GuildSecurityPolicyRepositoryError =
    | 'missing-guild-id'
    | 'invalid-defcon-level'
    | 'missing-category'
    | 'not-found'
    | 'database-error';

export type GuildFeatureRepositoryError =
    | { type: 'missing-input'; field: string }
    | { type: 'invalid-value'; field: string }
    | { type: 'invalid-status-transition'; from: string; to: string }
    | { type: 'not-found' }
    | { type: 'database-error' };

export type LoggingRepositoryError = GuildFeatureRepositoryError;

export const automodTriggerTypes = ['blocked_terms'] as const;
export type AutomodTriggerType = (typeof automodTriggerTypes)[number];

export const automodActionTypes = ['record', 'delete_message', 'timeout', 'warn'] as const;
export type AutomodActionType = (typeof automodActionTypes)[number];

export type AutomodRuleConfig = {
    terms?: string[];
    timeoutDurationSeconds?: number;
    ignoredChannelIds?: string[];
    ignoredRoleIds?: string[];
    ignoredUserIds?: string[];
};

export type AutomodRuleRecord = {
    actionType: AutomodActionType;
    config: AutomodRuleConfig;
    createdAt: Date;
    enabled: boolean;
    guildId: string;
    id: string;
    name: string;
    triggerType: AutomodTriggerType;
    updatedAt: Date;
};

export type AutomodEventRecord = {
    actionType: AutomodActionType;
    authorUserId: string;
    channelId: string;
    createdAt: Date;
    details: Record<string, unknown>;
    guildId: string;
    id: string;
    messageId: string;
    ruleId: string | null;
    status: string;
    triggerType: AutomodTriggerType;
};

export type SaveAutomodRuleInput = {
    guildId: string;
    ruleId?: string;
    name: string;
    triggerType: string;
    actionType?: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
};

export type RecordAutomodEventInput = {
    guildId: string;
    ruleId?: string | null;
    messageId: string;
    channelId: string;
    authorUserId: string;
    triggerType: string;
    actionType?: string;
    status?: string;
    details?: Record<string, unknown>;
};

export type UpdateAutomodEventStatusInput = {
    eventId: string;
    status: string;
    details?: Record<string, unknown>;
};

export type AutomodRepositoryError = GuildFeatureRepositoryError | { type: 'invalid-config' };

export type RoleReconciliationRunRecord = {
    createdAt: Date;
    guildId: string;
    id: string;
    status: string;
    summary: Record<string, unknown>;
    updatedAt: Date;
};

export type RoleReconciliationActionRecord = {
    actionType: string;
    createdAt: Date;
    details: Record<string, unknown>;
    id: string;
    roleId: string | null;
    runId: string;
    status: string;
    updatedAt: Date;
};

export type RoleReconciliationSettingsRecord = {
    cleanupDeletedRoleReferences: boolean;
    createdAt?: Date;
    enabled: boolean;
    guildId: string;
    restoreAutoroleRoles: boolean;
    restoreReactionRoles: boolean;
    restoreVerificationRoles: boolean;
    updatedAt?: Date;
};

export type RoleReconciliationSettingsInput = {
    cleanupDeletedRoleReferences?: boolean;
    enabled?: boolean;
    guildId: string;
    restoreAutoroleRoles?: boolean;
    restoreReactionRoles?: boolean;
    restoreVerificationRoles?: boolean;
};

export type RoleReconciliationRepositoryError = GuildFeatureRepositoryError;

export type DeletedGuildRoleReferenceCleanupSummary = {
    autoroleRulesDisabled: number;
    commandPermissionRulesUpdated: number;
    dashboardPermissionRulesUpdated: number;
    moderationPoliciesUpdated: number;
    reactionRoleAssignmentsRemoved: number;
    reactionRoleOptionsDeleted: number;
    ticketPanelsDisabled: number;
    ticketPanelsUpdated: number;
    verificationFlowsDisabled: number;
    xpRoleRewardsDeleted: number;
};

export type DeletedGuildRoleReferenceCleanupResult =
    | {
          runId: string;
          status: 'cleaned';
          summary: DeletedGuildRoleReferenceCleanupSummary;
      }
    | {
          status: 'unchanged';
          summary: DeletedGuildRoleReferenceCleanupSummary;
      };

export type GuildMemberFlowEventType = 'join' | 'leave';

export type GuildInviteAttributionStatus =
    | 'ambiguous'
    | 'attributed'
    | 'baseline-missing'
    | 'not-applicable'
    | 'unavailable';

export type GuildMemberFlowEventRecord = {
    attributionStatus: GuildInviteAttributionStatus;
    eventType: GuildMemberFlowEventType;
    guildId: string;
    id: string;
    inviteCode: string | null;
    inviterUserId: string | null;
    occurredAt: Date;
    userId: string;
};

export type GuildInviteSnapshotRecord = {
    active: boolean;
    channelId: string | null;
    code: string;
    expiresAt: Date | null;
    firstSeenAt: Date;
    guildId: string;
    id: string;
    inviterUserId: string | null;
    lastSeenAt: Date;
    maxUses: number | null;
    revokedAt: Date | null;
    temporary: boolean;
    uses: number;
};

export type GuildMessageActivityDayRecord = {
    activityDate: string;
    channelId: string;
    guildId: string;
    id: string;
    messageCount: number;
    updatedAt: Date;
};

export type GuildInviteSnapshotInput = {
    channelId?: string | null;
    code: string;
    expiresAt?: Date | null;
    inviterUserId?: string | null;
    maxUses?: number | null;
    temporary?: boolean | null;
    uses?: number | null;
};

export type GuildOverviewAggregate = {
    trackingStartedAt?: Date;
    memberFlow: {
        totalJoins: number;
        totalLeaves: number;
        netGrowth: number;
        graph: Array<{
            date: string;
            joins: number;
            leaves: number;
            netGrowth: number;
        }>;
    };
    invites: {
        activeInviteCount: number;
        totalInviteUses: number;
        attribution: Record<GuildInviteAttributionStatus, number>;
        topInviters: Array<{
            attributedJoins: number;
            inviteCodes: Array<{
                active: boolean;
                code: string;
                uses: number;
            }>;
            inviterUserId: string;
        }>;
    };
    messages: {
        totalMessages: number;
        graph: Array<{
            date: string;
            messageCount: number;
        }>;
        topChannels: Array<{
            channelId: string;
            messageCount: number;
        }>;
    };
    dataHealth: {
        hasInviteSnapshots: boolean;
        hasMemberFlow: boolean;
        hasMessageActivity: boolean;
    };
};

export type GrowthOverviewRepositoryError = GuildFeatureRepositoryError;

export type GuildCommandSettingsRecord = {
    createdAt: Date;
    guildId: string;
    prefix: string;
    updatedAt: Date;
};

export type GuildCommandSettingsRepositoryError =
    | 'missing-guild-id'
    | 'invalid-prefix'
    | 'invalid-config'
    | 'not-found'
    | 'database-error';

export type GuildModerationPolicyRecord = {
    createdAt: Date;
    guildId: string;
    protectedRoleIds: string[];
    protectedUserIds: string[];
    updatedAt: Date;
};

export type GuildModerationPolicyRepositoryError = GuildFeatureRepositoryError | { type: 'invalid-config' };

export type ModerationTemporaryActionStatus = 'cancelled' | 'completed' | 'failed' | 'pending';

export type ModerationTemporaryActionRecord = {
    action: string;
    caseId: string | null;
    createdAt: Date;
    expiresAt: Date;
    guildId: string;
    id: string;
    status: string;
    targetUserId: string;
    updatedAt: Date;
};

export type ModerationTemporaryActionRepositoryError = GuildFeatureRepositoryError;

export type MessageTemplateRecord = {
    content: string | null;
    createdAt: Date;
    createdByUserId: string | null;
    embeds: unknown[];
    guildId: string;
    id: string;
    name: string;
    updatedAt: Date;
};

export type PostedMessageRecord = {
    channelId: string;
    createdAt: Date;
    createdByUserId: string | null;
    guildId: string;
    id: string;
    messageId: string;
    purpose: string;
    templateId: string | null;
    updatedAt: Date;
};

export type PostingRepositoryError = GuildFeatureRepositoryError;

export type VerificationFlowRecord = {
    channelId: string;
    createdAt: Date;
    emojiKey: string;
    enabled: boolean;
    guildId: string;
    id: string;
    messageId: string;
    updatedAt: Date;
    verifiedRoleId: string;
};

export type VerificationRecord = {
    guildId: string;
    id: string;
    method: string;
    revokedAt: Date | null;
    userId: string;
    verifiedAt: Date;
};

export type VerificationRepositoryError = GuildFeatureRepositoryError;

export type AutoroleRuleRecord = {
    createdAt: Date;
    enabled: boolean;
    guildId: string;
    id: string;
    name: string | null;
    roleId: string;
    updatedAt: Date;
};

export type AutoroleRepositoryError = GuildFeatureRepositoryError;

export type GuildLoggingDestinationRecord = {
    channelId: string;
    createdAt: Date;
    enabled: boolean;
    eventGroup: ServerLogEventGroup;
    guildId: string;
    id: string;
    updatedAt: Date;
};

export type GuildLoggingDestinationRepositoryError = GuildFeatureRepositoryError;

export type SuggestionBoardRecord = {
    channelId: string;
    config: Record<string, unknown>;
    createdAt: Date;
    enabled: boolean;
    guildId: string;
    id: string;
    name: string;
    updatedAt: Date;
};

export type SuggestionRecord = {
    authorUserId: string;
    boardId: string | null;
    channelId: string | null;
    closedAt: Date | null;
    content: string;
    createdAt: Date;
    guildId: string;
    id: string;
    messageId: string | null;
    status: string;
    updatedAt: Date;
};

export type SuggestionVoteRecord = {
    createdAt: Date;
    id: string;
    suggestionId: string;
    updatedAt: Date;
    userId: string;
    vote: 'down' | 'up';
};

export type SuggestionsRepositoryError = GuildFeatureRepositoryError;

export type GuildCommandPermissionRuleTargetType = 'category' | 'command';

export type GuildCommandPermissionRuleRecord = {
    createdAt: Date;
    guildId: string;
    roleIds: string[];
    targetId: string;
    targetType: GuildCommandPermissionRuleTargetType;
    updatedAt: Date;
    userIds: string[];
};

export type GuildCommandPermissionRuleRepositoryError =
    | 'missing-guild-id'
    | 'invalid-target-type'
    | 'missing-target-id'
    | 'not-found'
    | 'database-error';

export type GuildDashboardPermissionRuleRecord = {
    createdAt: Date;
    guildId: string;
    roleIds: string[];
    updatedAt: Date;
    userIds: string[];
};

export type GuildDashboardPermissionRuleRepositoryError = 'missing-guild-id' | 'not-found' | 'database-error';

export type BotActionEventRecord = {
    action: string;
    actorUserId: string | null;
    createdAt: Date;
    feature: string;
    guildId: string | null;
    id: string;
    metadata: Record<string, unknown>;
    targetId: string | null;
};

export type BotActionEventCursor = {
    createdAt: Date;
    id: string;
};

export type BotActionEventPage = {
    records: BotActionEventRecord[];
    nextCursor?: BotActionEventCursor;
};

export type BotActionEventSearchScope = 'all' | 'event' | 'actor' | 'channel' | 'message' | 'time' | 'metadata';

export type EncryptedOAuthTokenPayload = {
    authTag: string;
    ciphertext: string;
    iv: string;
    version: string;
};

export type WebSessionRecord = {
    createdAt: Date;
    expiresAt: Date;
    fluxerUserId: string;
    id: string;
    revokedAt: Date | null;
};

export type WebSessionRepositoryError =
    | 'missing-session-id'
    | 'missing-fluxer-user-id'
    | 'invalid-expiry'
    | 'not-found'
    | 'database-error';

export type FluxerOAuthTokenRecord = {
    accessToken: EncryptedOAuthTokenPayload;
    accessTokenExpiresAt: Date;
    createdAt: Date;
    fluxerUserId: string;
    invalidatedAt: Date | null;
    refreshToken: EncryptedOAuthTokenPayload | null;
    scopes: string[];
    tokenType: string;
    updatedAt: Date;
};

export type FluxerOAuthTokenRepositoryError =
    | 'missing-fluxer-user-id'
    | 'invalid-access-token'
    | 'invalid-refresh-token'
    | 'missing-token-type'
    | 'invalid-expiry'
    | 'missing-scopes'
    | 'not-found'
    | 'database-error';
