import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    deleteReactionRoleMessage,
    deleteReactionRoleOptionByMessage,
    listReactionRoleMessagesByGuildId,
    recordBotActionEvent,
    upsertReactionRoleMessage,
    upsertReactionRoleOptionByMessage,
} from '@neonflux/db';
import type { ReactionRoleMessageWithOptions } from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardReactionRoleRole = {
    id: string;
    name: string;
    position: number;
};

export type DashboardReactionRoleChannel = {
    id: string;
    name: string;
    type: number;
    parentId?: string;
    parentName?: string;
    position?: number;
};

export type DashboardReactionRoleOption = {
    id: string;
    emojiKey: string;
    roleId: string;
    roleName?: string;
};

export type DashboardReactionRoleMessage = {
    id: string;
    channelId: string;
    channelName?: string;
    messageId: string;
    removeOnUnreact: boolean;
    enabled: boolean;
    staleAt?: string;
    updatedAt: string;
    options: DashboardReactionRoleOption[];
};

export type DashboardReactionRoleReadStatus = 'available' | 'bot-token-missing' | 'fetch-failed';

export type DashboardReactionRolesSettingsResult =
    | {
          type: 'settings';
          roles: DashboardReactionRoleRole[];
          channels: DashboardReactionRoleChannel[];
          structureReadStatus: DashboardReactionRoleReadStatus;
          messages: DashboardReactionRoleMessage[];
      }
    | DashboardReactionRolesErrorResult;

export type DashboardReactionRoleMessageUpdateInput = {
    guildId: string;
    channelId: string;
    messageId: string;
    removeOnUnreact?: boolean;
    enabled?: boolean;
};

export type DashboardReactionRoleOptionUpdateInput = {
    guildId: string;
    messageId: string;
    emojiKey: string;
    roleId: string;
};

export type DashboardReactionRoleOptionDeleteInput = {
    guildId: string;
    messageId: string;
    emojiKey: string;
};

export type DashboardReactionRoleMessageDeleteInput = {
    guildId: string;
    messageId: string;
};

export type DashboardReactionRoleMessageUpdateResult =
    | { type: 'updated'; message: DashboardReactionRoleMessage }
    | { type: 'invalid-input'; field: string }
    | DashboardReactionRolesErrorResult;

export type DashboardReactionRoleOptionUpdateResult =
    | { type: 'updated'; option: DashboardReactionRoleOption }
    | { type: 'invalid-input'; field: string }
    | DashboardReactionRolesErrorResult;

export type DashboardReactionRoleOptionDeleteResult =
    | { type: 'deleted'; option: DashboardReactionRoleOption }
    | { type: 'invalid-input'; field: string }
    | DashboardReactionRolesErrorResult;

export type DashboardReactionRoleMessageDeleteResult =
    | { type: 'deleted'; message: DashboardReactionRoleMessage }
    | { type: 'invalid-input'; field: string }
    | DashboardReactionRolesErrorResult;

type DashboardReactionRolesErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;
type DashboardReactionRoleMutationErrorResult =
    | { type: 'invalid-input'; field: string }
    | DashboardReactionRolesErrorResult;

const dashboardReactionRolesFeature = 'reaction_roles';
const textChannelTypes = new Set([0, 5]);

export async function loadDashboardReactionRolesSettings(
    request: Request,
    guildId: string
): Promise<DashboardReactionRolesSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const messagesResult = await listReactionRoleMessagesByGuildId(getWebDatabaseClient().db, {
        guildId: guildPageData.guild.id,
    });

    if (messagesResult.isErr()) {
        return { type: 'database-error' };
    }

    const structureResult = await loadReactionRoleStructure(guildPageData.guild.id);

    return {
        type: 'settings',
        roles: structureResult.roles,
        channels: structureResult.channels,
        structureReadStatus: structureResult.status,
        messages: messagesResult.value.map((message) =>
            toDashboardReactionRoleMessage(message, structureResult.rolesById, structureResult.channelsById)
        ),
    };
}

export async function updateDashboardReactionRoleMessage(
    request: Request,
    input: DashboardReactionRoleMessageUpdateInput
): Promise<DashboardReactionRoleMessageUpdateResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveReactionRoleActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const messageResult = await upsertReactionRoleMessage(database.db, {
        guildId: guildPageData.guild.id,
        channelId: input.channelId,
        messageId: input.messageId,
        removeOnUnreact: input.removeOnUnreact ?? true,
        enabled: input.enabled ?? true,
    });

    if (messageResult.isErr()) {
        return mapReactionRoleRepositoryError(messageResult.error);
    }

    const structureResult = await loadReactionRoleStructure(guildPageData.guild.id);
    const auditResult = await recordReactionRoleAuditEvent(database.db, guildPageData, actorResult, {
        action: 'message.updated',
        targetId: messageResult.value.messageId,
        metadata: {
            channelId: messageResult.value.channelId,
            ...(structureResult.channelsById.get(messageResult.value.channelId)
                ? { channelName: structureResult.channelsById.get(messageResult.value.channelId)?.name }
                : {}),
            messageId: messageResult.value.messageId,
            removeOnUnreact: messageResult.value.removeOnUnreact,
            enabled: messageResult.value.enabled,
        },
    });

    if (auditResult === 'database-error') {
        return { type: 'database-error' };
    }

    return {
        type: 'updated',
        message: toDashboardReactionRoleMessage(
            messageResult.value,
            structureResult.rolesById,
            structureResult.channelsById
        ),
    };
}

export async function updateDashboardReactionRoleOption(
    request: Request,
    input: DashboardReactionRoleOptionUpdateInput
): Promise<DashboardReactionRoleOptionUpdateResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveReactionRoleActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const optionResult = await upsertReactionRoleOptionByMessage(database.db, {
        guildId: guildPageData.guild.id,
        messageId: input.messageId,
        emojiKey: input.emojiKey,
        roleId: input.roleId,
    });

    if (optionResult.isErr()) {
        return mapReactionRoleRepositoryError(optionResult.error);
    }

    const structureResult = await loadReactionRoleStructure(guildPageData.guild.id);
    const option = toDashboardReactionRoleOption(optionResult.value, structureResult.rolesById);
    const auditResult = await recordReactionRoleAuditEvent(database.db, guildPageData, actorResult, {
        action: 'option.updated',
        targetId: input.messageId,
        metadata: {
            messageId: input.messageId,
            emojiKey: option.emojiKey,
            roleId: option.roleId,
            ...(option.roleName ? { roleName: option.roleName } : {}),
        },
    });

    if (auditResult === 'database-error') {
        return { type: 'database-error' };
    }

    return {
        type: 'updated',
        option,
    };
}

export async function deleteDashboardReactionRoleOption(
    request: Request,
    input: DashboardReactionRoleOptionDeleteInput
): Promise<DashboardReactionRoleOptionDeleteResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveReactionRoleActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const optionResult = await deleteReactionRoleOptionByMessage(database.db, {
        guildId: guildPageData.guild.id,
        messageId: input.messageId,
        emojiKey: input.emojiKey,
    });

    if (optionResult.isErr()) {
        return mapReactionRoleRepositoryError(optionResult.error);
    }

    const structureResult = await loadReactionRoleStructure(guildPageData.guild.id);
    const option = toDashboardReactionRoleOption(optionResult.value, structureResult.rolesById);
    const auditResult = await recordReactionRoleAuditEvent(database.db, guildPageData, actorResult, {
        action: 'option.deleted',
        targetId: input.messageId,
        metadata: {
            messageId: input.messageId,
            emojiKey: option.emojiKey,
            roleId: option.roleId,
            ...(option.roleName ? { roleName: option.roleName } : {}),
        },
    });

    if (auditResult === 'database-error') {
        return { type: 'database-error' };
    }

    return {
        type: 'deleted',
        option,
    };
}

export async function deleteDashboardReactionRoleMessage(
    request: Request,
    input: DashboardReactionRoleMessageDeleteInput
): Promise<DashboardReactionRoleMessageDeleteResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveReactionRoleActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const messageResult = await deleteReactionRoleMessage(database.db, {
        guildId: guildPageData.guild.id,
        messageId: input.messageId,
    });

    if (messageResult.isErr()) {
        return mapReactionRoleRepositoryError(messageResult.error);
    }

    const structureResult = await loadReactionRoleStructure(guildPageData.guild.id);
    const message = toDashboardReactionRoleMessage(
        messageResult.value,
        structureResult.rolesById,
        structureResult.channelsById
    );
    const auditResult = await recordReactionRoleAuditEvent(database.db, guildPageData, actorResult, {
        action: 'message.deleted',
        targetId: message.messageId,
        metadata: {
            channelId: message.channelId,
            ...(message.channelName ? { channelName: message.channelName } : {}),
            messageId: message.messageId,
        },
    });

    if (auditResult === 'database-error') {
        return { type: 'database-error' };
    }

    return {
        type: 'deleted',
        message,
    };
}

async function loadReactionRoleStructure(guildId: string): Promise<{
    status: DashboardReactionRoleReadStatus;
    roles: DashboardReactionRoleRole[];
    channels: DashboardReactionRoleChannel[];
    rolesById: Map<string, DashboardReactionRoleRole>;
    channelsById: Map<string, DashboardReactionRoleChannel>;
}> {
    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) {
        return emptyReactionRoleStructure('bot-token-missing');
    }

    const structureResult = await readFluxerBotGuildStructure({
        botToken,
        guildId,
    });

    if (structureResult.isErr()) {
        return emptyReactionRoleStructure('fetch-failed');
    }

    const roles = structureResult.value.roles
        .filter((role) => role.name !== '@everyone')
        .map((role) => ({
            id: role.id,
            name: role.name,
            position: role.position,
        }))
        .sort((left, right) => right.position - left.position || left.name.localeCompare(right.name));
    const categoryNameById = new Map(structureResult.value.categories.map((category) => [category.id, category.name]));
    const channels = structureResult.value.channels
        .filter((channel) => textChannelTypes.has(channel.type))
        .map((channel): DashboardReactionRoleChannel => {
            const parentName = channel.parentId ? categoryNameById.get(channel.parentId) : undefined;

            return {
                id: channel.id,
                name: channel.name ?? channel.id,
                type: channel.type,
                ...(channel.parentId ? { parentId: channel.parentId } : {}),
                ...(parentName ? { parentName } : {}),
                ...(channel.position !== null ? { position: channel.position } : {}),
            };
        })
        .sort(compareReactionRoleChannels);

    return {
        status: 'available',
        roles,
        channels,
        rolesById: new Map(roles.map((role) => [role.id, role])),
        channelsById: new Map(channels.map((channel) => [channel.id, channel])),
    };
}

function emptyReactionRoleStructure(status: Exclude<DashboardReactionRoleReadStatus, 'available'>) {
    return {
        status,
        roles: [],
        channels: [],
        rolesById: new Map<string, DashboardReactionRoleRole>(),
        channelsById: new Map<string, DashboardReactionRoleChannel>(),
    };
}

function toDashboardReactionRoleMessage(
    record: ReactionRoleMessageWithOptions | Omit<ReactionRoleMessageWithOptions, 'options'>,
    rolesById: ReadonlyMap<string, DashboardReactionRoleRole>,
    channelsById: ReadonlyMap<string, DashboardReactionRoleChannel>
): DashboardReactionRoleMessage {
    const channel = channelsById.get(record.channelId);
    const options = 'options' in record ? record.options : [];

    return {
        id: record.id,
        channelId: record.channelId,
        ...(channel ? { channelName: channel.name } : {}),
        messageId: record.messageId,
        removeOnUnreact: record.removeOnUnreact,
        enabled: record.enabled,
        ...(record.staleAt ? { staleAt: record.staleAt.toISOString() } : {}),
        updatedAt: record.updatedAt.toISOString(),
        options: options.map((option) => toDashboardReactionRoleOption(option, rolesById)),
    };
}

function toDashboardReactionRoleOption(
    record: { id: string; emojiKey: string; roleId: string },
    rolesById: ReadonlyMap<string, DashboardReactionRoleRole>
): DashboardReactionRoleOption {
    const role = rolesById.get(record.roleId);

    return {
        id: record.id,
        emojiKey: record.emojiKey,
        roleId: record.roleId,
        ...(role ? { roleName: role.name } : {}),
    };
}

function compareReactionRoleChannels(left: DashboardReactionRoleChannel, right: DashboardReactionRoleChannel): number {
    const leftCategory = left.parentName ?? '';
    const rightCategory = right.parentName ?? '';

    if (leftCategory !== rightCategory) {
        return leftCategory.localeCompare(rightCategory);
    }

    return (left.position ?? 0) - (right.position ?? 0) || left.name.localeCompare(right.name);
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardReactionRolesErrorResult {
    switch (guildPageData.type) {
        case 'auth-required':
        case 'deployment-config-not-found':
        case 'database-error':
        case 'guild-lookup-failed':
            return { type: guildPageData.type };

        case 'not-found':
        case 'single-unauthorized':
            return { type: 'not-found' };
    }
}

function mapReactionRoleRepositoryError(error: {
    type: string;
    field?: string;
}): DashboardReactionRoleMutationErrorResult {
    switch (error.type) {
        case 'missing-input':
        case 'invalid-value':
            return { type: 'invalid-input', field: error.field ?? 'unknown' };
        case 'not-found':
            return { type: 'not-found' };
        case 'database-error':
        default:
            return { type: 'database-error' };
    }
}

type ReactionRoleActor =
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' };

async function resolveReactionRoleActor(request: Request): Promise<ReactionRoleActor> {
    const authContextResult = await readAuthenticatedFluxerContext(request);

    if (authContextResult.isErr()) {
        return authContextResult.error === 'database-error' ? { type: 'database-error' } : { type: 'auth-required' };
    }

    const currentUserResult = await getFluxerCurrentUser({
        accessToken: authContextResult.value.accessToken,
    });

    if (currentUserResult.isErr() || currentUserResult.value.id !== authContextResult.value.fluxerUserId) {
        return {
            type: 'actor',
            actorUserId: authContextResult.value.fluxerUserId,
            metadata: {},
        };
    }

    return {
        type: 'actor',
        actorUserId: authContextResult.value.fluxerUserId,
        metadata: {
            actorUsername: currentUserResult.value.username,
            ...(currentUserResult.value.globalName ? { actorDisplayName: currentUserResult.value.globalName } : {}),
        },
    };
}

async function recordReactionRoleAuditEvent(
    db: Parameters<typeof recordBotActionEvent>[0],
    guildPageData: AuthorizedGuildPageData,
    actor: Extract<ReactionRoleActor, { type: 'actor' }>,
    input: {
        action: string;
        targetId: string;
        metadata: Record<string, string | number | boolean | null | undefined>;
    }
): Promise<'recorded' | 'database-error'> {
    const rawMetadata: Record<string, string | number | boolean | null | undefined> = {
        ...input.metadata,
        source: 'dashboard',
        ...actor.metadata,
    };
    const metadataEntries = Object.entries(rawMetadata).filter((entry) => entry[1] !== undefined) as Array<
        [string, string | number | boolean | null]
    >;
    const metadata = Object.fromEntries(metadataEntries);
    const result = await recordBotActionEvent(db, {
        guildId: guildPageData.guild.id,
        feature: dashboardReactionRolesFeature,
        action: input.action,
        actorUserId: actor.actorUserId,
        targetId: input.targetId,
        metadata,
    });

    return result.isOk() ? 'recorded' : 'database-error';
}
