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
    lifecycle: 'deleting' | 'needs_attention' | 'ready' | 'syncing';
    pendingOperationId?: string;
    revision: number;
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
          operations: DashboardReactionRoleOperation[];
      }
    | DashboardReactionRolesErrorResult;

export type DashboardReactionRoleMessageSaveInput = {
    guildId: string;
    messageId: string;
    expectedRevision: number;
    idempotencyKey: string;
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
    expectedRevision: number;
    guildId: string;
    idempotencyKey: string;
    messageId: string;
};

export type DashboardReactionRoleOperation = {
    blockedCount: number;
    channelId: string;
    completedAt?: string;
    errorCode?: string;
    externalMessageId?: string;
    id: string;
    processedCount: number;
    status: 'cancelled' | 'needs_attention' | 'queued' | 'running' | 'succeeded' | 'waiting_retry';
    totalCount: number;
    type: 'delete' | 'publish' | 'save';
    updatedAt: string;
};

type DashboardReactionRoleOperationAcceptedResult = {
    type: 'operation-accepted' | 'operation-existing';
    operation: DashboardReactionRoleOperation;
};

export type DashboardReactionRolePublishResult =
    | DashboardReactionRoleOperationAcceptedResult
    | { type: 'operation-busy'; operation?: DashboardReactionRoleOperation }
    | { type: 'idempotency-conflict' }
    | { type: 'revision-conflict'; currentRevision: number }
    | { type: 'invalid-input'; field: string; message?: string }
    | { type: 'bot-token-missing' }
    | { type: 'send-failed' }
    | DashboardReactionRolesErrorResult;

export type DashboardReactionRoleMessageSaveResult =
    | DashboardReactionRoleOperationAcceptedResult
    | { type: 'operation-busy'; operation?: DashboardReactionRoleOperation }
    | { type: 'idempotency-conflict' }
    | { type: 'revision-conflict'; currentRevision: number }
    | { type: 'invalid-input'; field: string; message?: string }
    | { type: 'bot-token-missing' }
    | { type: 'edit-failed' }
    | DashboardReactionRolesErrorResult;

export type DashboardReactionRoleMessageDeleteResult =
    | DashboardReactionRoleOperationAcceptedResult
    | { type: 'operation-busy'; operation?: DashboardReactionRoleOperation }
    | { type: 'idempotency-conflict' }
    | { type: 'revision-conflict'; currentRevision: number }
    | { type: 'invalid-input'; field: string }
    | DashboardReactionRolesErrorResult;

export type DashboardReactionRoleRetryResult =
    | { type: 'operation-accepted'; operation: DashboardReactionRoleOperation }
    | { type: 'confirmation-required' }
    | DashboardReactionRolesErrorResult;

export type DashboardReactionRoleMutationErrorResult =
    | { type: 'invalid-input'; field: string }
    | DashboardReactionRolesErrorResult;

export type { DashboardReactionRolePublishInput };
