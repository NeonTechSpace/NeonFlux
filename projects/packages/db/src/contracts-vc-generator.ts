import type { GuildFeatureRepositoryError } from './contracts.js';

export type VcGeneratorRuleRecord = {
    id: string;
    guildId: string;
    sourceChannelId: string;
    categoryId: string | null;
    nameTemplate: string;
    enabled: boolean;
    config: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
};

export type GeneratedVoiceChannelRecord = {
    id: string;
    guildId: string;
    ruleId: string | null;
    channelId: string;
    ownerUserId: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    lastSeenAt: Date;
};

export type VcGeneratorControlPanelRecord = {
    id: string;
    guildId: string;
    ruleId: string;
    channelId: string;
    messageId: string | null;
    controlMode: string;
    status: string;
    config: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
    lastSyncedAt: Date | null;
    staleAt: Date | null;
};

export type VcGeneratorRepositoryError = GuildFeatureRepositoryError;

export type GeneratedVoiceChannelStatus = 'active' | 'deleted' | 'orphaned';
export type VcGeneratorControlPanelStatus = 'active' | 'stale' | 'disabled';
export type VcGeneratorControlMode = 'reaction';

export type GeneratedVoiceChannelControlRecord = GeneratedVoiceChannelRecord;

export type VcGeneratorControlAction = 'rename' | 'user_limit' | 'whitelist' | 'blacklist' | 'lock' | 'unlock';
export type VcGeneratorControlRequestStatus = 'pending' | 'applied' | 'failed' | 'cancelled' | 'expired';

export type VcGeneratorControlRequestRecord = {
    id: string;
    guildId: string;
    generatedChannelId: string;
    panelChannelId: string;
    targetChannelId: string;
    requesterUserId: string;
    controlAction: string;
    status: string;
    promptMessageId: string | null;
    value: string | null;
    errorMessage: string | null;
    expiresAt: Date;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

export type VcGeneratorControlRequestError = GuildFeatureRepositoryError;
