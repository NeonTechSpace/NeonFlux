import type { ReactionRoleMessageMode } from '@neonflux/db';

import type {
    DashboardReactionRoleEmbedPayload,
    DashboardReactionRolePublishInput,
} from './dashboard-reaction-roles-payload.js';

export type DashboardReactionRoleMode = ReactionRoleMessageMode;

export type DashboardReactionRoleRole = {
    id: string;
    name: string;
    position: number;
    color: number;
};

export type DashboardReactionRoleChannel = {
    id: string;
    name: string;
    type: number;
    parentId?: string;
    parentName?: string;
    position?: number;
};

export type DashboardReactionRoleEmoji = {
    key: string;
    label: string;
    name: string;
    custom: boolean;
    animated: boolean;
    id?: string;
    url?: string;
};

type DashboardReactionRoleOption = {
    id: string;
    emojiKey: string;
    emojiLabel?: string;
    roleId: string;
    roleName?: string;
    roleColor?: number;
    position: number;
};

export type DashboardReactionRoleMessage = {
    id: string;
    channelId: string;
    channelName?: string;
    messageId: string;
    mode: DashboardReactionRoleMode;
    source: 'existing' | 'dashboard';
    messageContent?: string;
    messageEmbeds: DashboardReactionRoleEmbedPayload[];
    generateOverview: boolean;
    enabled: boolean;
    staleAt?: string;
    updatedAt: string;
    options: DashboardReactionRoleOption[];
};

export type DashboardReactionRoleReadStatus = 'available' | 'bot-token-missing' | 'fetch-failed';

type DashboardReactionRolesErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

export type DashboardReactionRolesSettingsResult =
    | {
          type: 'settings';
          roles: DashboardReactionRoleRole[];
          channels: DashboardReactionRoleChannel[];
          emojis: DashboardReactionRoleEmoji[];
          structureReadStatus: DashboardReactionRoleReadStatus;
          emojiReadStatus: DashboardReactionRoleReadStatus;
          messages: DashboardReactionRoleMessage[];
      }
    | DashboardReactionRolesErrorResult;

export type DashboardReactionRoleMessageSaveInput = {
    guildId: string;
    messageId: string;
    content?: string;
    embeds?: DashboardReactionRoleEmbedPayload[];
    mode: DashboardReactionRoleMode;
    generateOverview: boolean;
    options: Array<{
        emojiKey: string;
        emojiLabel?: string;
        roleId: string;
        position: number;
    }>;
};

export type DashboardReactionRoleMessageDeleteInput = {
    guildId: string;
    messageId: string;
};

export type DashboardReactionRolePublishResult =
    | { type: 'published'; message: DashboardReactionRoleMessage; seedFailures: string[] }
    | { type: 'published-with-seed-errors'; message: DashboardReactionRoleMessage; seedFailures: string[] }
    | { type: 'invalid-input'; field: string; message?: string }
    | { type: 'bot-token-missing' }
    | { type: 'send-failed' }
    | DashboardReactionRolesErrorResult;

export type DashboardReactionRoleMessageSaveResult =
    | { type: 'saved'; message: DashboardReactionRoleMessage; seedFailures: string[]; cleanupFailures: string[] }
    | {
          type: 'saved-with-reaction-errors';
          message: DashboardReactionRoleMessage;
          seedFailures: string[];
          cleanupFailures: string[];
      }
    | { type: 'invalid-input'; field: string; message?: string }
    | { type: 'bot-token-missing' }
    | { type: 'edit-failed' }
    | DashboardReactionRolesErrorResult;

export type DashboardReactionRoleMessageDeleteResult =
    | { type: 'deleted'; message: DashboardReactionRoleMessage }
    | { type: 'invalid-input'; field: string }
    | DashboardReactionRolesErrorResult;

export type DashboardReactionRoleMutationErrorResult =
    | { type: 'invalid-input'; field: string }
    | DashboardReactionRolesErrorResult;

export type { DashboardReactionRolePublishInput };
