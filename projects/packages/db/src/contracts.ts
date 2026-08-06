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

export type DashboardGuildAuthorizationFacts = {
    deployment: { instanceMode: 'single'; singleGuildId: string } | { instanceMode: 'multi' } | null;
    botInstalled: boolean;
    storedDefconLevel: 1 | 2 | 3 | null;
};

export type DashboardGuildAuthorizationFactsRepositoryError = 'missing-guild-id' | 'database-error';

export type BotInstallationRecord = {
    guildId: string;
    installedAt: Date;
    updatedAt: Date;
};

export type BotInstallationRepositoryError = 'missing-guild-id' | 'not-found' | 'database-error';

type GuildDefconLevel = 1 | 2 | 3;

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

export type GuildMemberFlowEventType = 'join' | 'leave';

export type GuildMemberFlowEventRecord = {
    eventType: GuildMemberFlowEventType;
    guildId: string;
    id: string;
    membershipStartedAt: Date | null;
    occurredAt: Date;
    userId: string;
};

export type GuildMessageActivityRecord = {
    activityDate: string;
    guildId: string;
    shard: number;
    status: 'duplicate' | 'recorded';
};

export type GuildOverviewAggregate = {
    oldestRetainedActivityAt?: Date;
    windowDays: number;
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
    messages: {
        totalMessages: number;
        graph: Array<{
            date: string;
            messageCount: number;
        }>;
    };
    activityPresence: {
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

export type MessageTemplateRecord = {
    content: string | null;
    createdAt: Date;
    createdByUserId: string | null;
    embeds: OutgoingEmbed[];
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

export type DashboardPostingOperationStatus = 'queued' | 'running' | 'unknown' | 'sent' | 'permanent_failure';

export type DashboardPostingOperationRecord = {
    actorDisplayName: string | null;
    actorUsername: string | null;
    actorUserId: string;
    allowMassMentions: boolean;
    attemptCount: number;
    completedAt: Date | null;
    contentLength: number;
    createdAt: Date;
    embedCount: number;
    errorCode: string | null;
    followupOperationId: string | null;
    guildId: string;
    id: string;
    messageId: string | null;
    nextAttemptAt: Date | null;
    requestKey: string;
    requestedChannelId: string;
    resolution: DashboardPostingOperationResolution | null;
    resolvedAt: Date | null;
    resolvedByUserId: string | null;
    retryOfOperationId: string | null;
    sentChannelId: string | null;
    status: DashboardPostingOperationStatus;
    updatedAt: Date;
};

export type DashboardPostingOperationWorkerRecord = DashboardPostingOperationRecord & {
    content: string | null;
    embeds: OutgoingEmbed[];
    externalChannelId: string | null;
    externalMessageId: string | null;
    leaseExpiresAt: Date | null;
    leaseId: string | null;
    leaseOwner: string | null;
    sendStartedAt: Date | null;
};

export type DashboardPostingOperationRepositoryError =
    | GuildFeatureRepositoryError
    | { type: 'conflict'; field: 'requestKey' | 'resolution' };

export type PostingRepositoryError = GuildFeatureRepositoryError | { type: 'conflict'; field: 'name' | 'updatedAt' };

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

export type BotActionEventCursor = string;

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
    credentialGeneration: number;
    createdAt: Date;
    fluxerUserId: string;
    invalidatedAt: Date | null;
    refreshToken: EncryptedOAuthTokenPayload | null;
    scopes: string[];
    tokenType: string;
    updatedAt: Date;
};

export type FluxerOAuthRefreshLeaseClaim =
    | { status: 'claimed' }
    | { retryAt: Date; status: 'busy' | 'cooldown' }
    | { status: 'missing' | 'stale' };

export type FluxerOAuthRefreshCompletion =
    | { status: 'applied'; tokenSet: FluxerOAuthTokenRecord }
    | { status: 'stale' };

export type FluxerOAuthRefreshMutationStatus = { status: 'applied' | 'deleted' | 'stale' };

export type FluxerOAuthTokenRepositoryError =
    | 'missing-fluxer-user-id'
    | 'invalid-access-token'
    | 'invalid-refresh-token'
    | 'missing-token-type'
    | 'invalid-expiry'
    | 'missing-scopes'
    | 'not-found'
    | 'database-error';
import type { DashboardPostingOperationResolution, OutgoingEmbed } from '@neonflux/messaging';
