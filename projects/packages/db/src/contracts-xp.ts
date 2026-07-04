import type { GuildFeatureRepositoryError } from './contracts.js';

export type XpSettingsRecord = {
    config: Record<string, unknown>;
    cooldownSeconds: number;
    enabled: boolean;
    guildId: string;
    messageXpMax: number;
    messageXpMin: number;
    updatedAt: Date;
    voiceMinimumMinutes: number;
    voiceXpPerMinute: number;
};

export type GuildUserXpRecord = {
    guildId: string;
    id: string;
    lastMessageXpAt: Date | null;
    lastVoiceXpAt: Date | null;
    level: number;
    messageCount: number;
    messageXp: number;
    updatedAt: Date;
    userId: string;
    voiceSeconds: number;
    voiceXp: number;
    xp: number;
};

export type XpGrantSource = 'message' | 'voice';

export type XpGrantRecord = {
    grantedAt: Date;
    guildId: string;
    id: string;
    idempotencyKey: string;
    levelAfter: number;
    levelBefore: number;
    metadata: Record<string, unknown>;
    source: XpGrantSource;
    userId: string;
    xp: number;
};

export type XpRoleRewardRecord = {
    createdAt: Date;
    guildId: string;
    id: string;
    level: number;
    roleId: string;
    updatedAt: Date;
};

export type GrantGuildUserXpResult =
    | { grant: XpGrantRecord; status: 'granted'; userXp: GuildUserXpRecord }
    | { status: 'duplicate'; userXp: GuildUserXpRecord | undefined };

export type GuildUserXpRank = {
    rank: number;
    userXp: GuildUserXpRecord;
};

export type XpRepositoryError = GuildFeatureRepositoryError;

export type XpVoiceSessionRecord = {
    channelId: string;
    createdAt: Date;
    creditedSeconds: number;
    endedAt: Date | null;
    guildId: string;
    id: string;
    startedAt: Date;
    status: string;
    updatedAt: Date;
    userId: string;
};

export type ClosedXpVoiceSession = {
    durationSeconds: number;
    session: XpVoiceSessionRecord;
};

export type XpVoiceSessionTransition =
    | { active: XpVoiceSessionRecord; closed?: ClosedXpVoiceSession; status: 'started' }
    | { active: XpVoiceSessionRecord; status: 'unchanged' };

export type XpVoiceSessionRepositoryError = GuildFeatureRepositoryError;
