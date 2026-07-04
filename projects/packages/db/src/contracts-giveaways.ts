import type { GuildFeatureRepositoryError } from './contracts.js';

export type GiveawayRecord = {
    id: string;
    guildId: string;
    channelId: string;
    messageId: string | null;
    title: string;
    prize: string;
    description: string | null;
    entryEmoji: string;
    winnerCount: number;
    status: string;
    endsAt: Date | null;
    createdByUserId: string | null;
    closedByUserId: string | null;
    closedAt: Date | null;
    config: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
};

export type GiveawayEntryRecord = {
    id: string;
    giveawayId: string;
    userId: string;
    enteredAt: Date;
    removedAt: Date | null;
};

export type GiveawayWinnerRecord = {
    id: string;
    giveawayId: string;
    userId: string;
    drawNumber: number;
    selectedAt: Date;
};

export type GiveawayEventRecord = {
    id: string;
    giveawayId: string;
    eventType: string;
    actorUserId: string | null;
    details: Record<string, unknown>;
    createdAt: Date;
};

export type GiveawaysRepositoryError = GuildFeatureRepositoryError;

export type GiveawayMaintenanceRepositoryError = GuildFeatureRepositoryError;
export type GiveawaySyncStatus = 'active' | 'stale';

export type GiveawayReconciliationRepositoryError = GuildFeatureRepositoryError;
