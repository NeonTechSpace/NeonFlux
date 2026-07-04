import type { GuildFeatureRepositoryError } from './contracts.js';

export type ModerationCaseRecord = {
    id: string;
    guildId: string;
    caseNumber: number;
    action: string;
    targetType: string;
    targetUserId: string | null;
    targetChannelId: string | null;
    actorUserId: string | null;
    reason: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
};

export type ModerationCaseEventRecord = {
    id: string;
    caseId: string;
    eventType: string;
    actorUserId: string | null;
    details: Record<string, unknown>;
    createdAt: Date;
};

export type ModerationRepositoryError = GuildFeatureRepositoryError;
