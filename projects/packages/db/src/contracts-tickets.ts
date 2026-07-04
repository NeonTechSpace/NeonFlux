import type { GuildFeatureRepositoryError } from './contracts.js';

export type TicketPanelRecord = {
    id: string;
    guildId: string;
    channelId: string;
    messageId: string | null;
    title: string;
    enabled: boolean;
    config: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
};

export type TicketRecord = {
    id: string;
    guildId: string;
    panelId: string | null;
    ticketNumber: number;
    channelId: string | null;
    openerUserId: string;
    status: string;
    claimedByUserId: string | null;
    openedAt: Date;
    closedAt: Date | null;
    updatedAt: Date;
};

export type TicketMemberRecord = {
    id: string;
    ticketId: string;
    userId: string;
    role: string;
    createdAt: Date;
};

export type TicketEventRecord = {
    id: string;
    ticketId: string;
    eventType: string;
    actorUserId: string | null;
    details: Record<string, unknown>;
    createdAt: Date;
};

export type TicketsRepositoryError = GuildFeatureRepositoryError;
