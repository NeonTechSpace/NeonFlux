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
    messageContent: string | null;
    messageEmbeds: unknown[];
    messageId: string;
    mode: ReactionRoleMessageMode;
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
    emojiKey: string;
    guildId: string;
    id: string;
    messageId: string;
    removedAt: Date | null;
    roleId: string;
    userId: string;
};

export type ReactionRoleMessageWithOptions = ReactionRoleMessageRecord & {
    options: ReactionRoleOptionRecord[];
};

export type ReactionRoleOptionMatch = {
    message: ReactionRoleMessageRecord;
    option: ReactionRoleOptionRecord;
};

export type ReactionRolesRepositoryError = GuildFeatureRepositoryError;
