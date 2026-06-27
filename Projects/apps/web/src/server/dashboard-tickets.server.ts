import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    createTicketPanel,
    deleteTicketPanel,
    listTicketPanelsByGuildId,
    recordBotActionEvent,
    updateTicketPanel,
} from '@neonflux/db';
import type { TicketPanelRecord } from '@neonflux/db';
import {
    reactFluxerBotGuildChannelMessage,
    readFluxerBotGuildStructure,
    sendFluxerBotGuildChannelMessage,
} from '@neonflux/fluxer';
import type { FluxerGuildChannel, FluxerGuildRole } from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardTicketChannel = {
    id: string;
    name: string;
    type: number;
    position: number;
    parentId?: string;
    parentName?: string;
};

export type DashboardTicketCategory = {
    id: string;
    name: string;
    position: number;
};

export type DashboardTicketRole = {
    id: string;
    name: string;
    position: number;
};

export type DashboardTicketPanelConfig = {
    description: string;
    openEmoji: string;
    openEmojiKey: string;
    ticketCategoryId: string;
    staffRoleIds: string[];
    ticketNameTemplate: string;
    maxOpenPerUser: number;
    privateTickets: boolean;
    syncStatus: 'active' | 'stale';
};

export type DashboardTicketPanel = {
    id: string;
    channelId: string;
    channelName?: string;
    messageId?: string;
    title: string;
    enabled: boolean;
    config: DashboardTicketPanelConfig;
    updatedAt: string;
};

export type DashboardTicketsStructureReadStatus = 'available' | 'bot-token-missing' | 'fetch-failed';

export type DashboardTicketsSettingsResult =
    | {
          type: 'settings';
          structureReadStatus: DashboardTicketsStructureReadStatus;
          textChannels: DashboardTicketChannel[];
          categories: DashboardTicketCategory[];
          roles: DashboardTicketRole[];
          panels: DashboardTicketPanel[];
      }
    | DashboardTicketsErrorResult;

export type DashboardTicketPanelUpdateInput = {
    guildId: string;
    panelId?: string;
    channelId: string;
    title: string;
    description?: string;
    openEmoji?: string;
    ticketCategoryId?: string;
    staffRoleIds?: string[];
    ticketNameTemplate?: string;
    maxOpenPerUser?: number;
    privateTickets?: boolean;
    enabled?: boolean;
};

export type DashboardTicketPanelDeleteInput = {
    guildId: string;
    panelId: string;
};

export type DashboardTicketPanelUpdateResult =
    | { type: 'updated'; panel: DashboardTicketPanel }
    | { type: 'invalid-input'; field: string }
    | { type: 'bot-token-missing' }
    | { type: 'message-send-error' }
    | DashboardTicketsErrorResult;

export type DashboardTicketPanelDeleteResult =
    | { type: 'deleted'; panel: DashboardTicketPanel }
    | { type: 'invalid-input'; field: string }
    | DashboardTicketsErrorResult;

type DashboardTicketsErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };
type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;
const dashboardTicketsFeature = 'tickets';
const textChannelTypes = new Set([0, 5]);
const defaultPanelConfig: DashboardTicketPanelConfig = {
    description: 'React to open a ticket.',
    openEmoji: '🎫',
    openEmojiKey: 'unicode:🎫',
    ticketCategoryId: '',
    staffRoleIds: [],
    ticketNameTemplate: 'ticket-{number}',
    maxOpenPerUser: 1,
    privateTickets: true,
    syncStatus: 'active',
};

export async function loadDashboardTicketsSettings(
    request: Request,
    guildId: string
): Promise<DashboardTicketsSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const panelsResult = await listTicketPanelsByGuildId(getWebDatabaseClient().db, {
        guildId: guildPageData.guild.id,
    });

    if (panelsResult.isErr()) {
        return { type: 'database-error' };
    }

    const structureResult = await loadTicketsStructure(guildPageData.guild.id);

    return {
        type: 'settings',
        structureReadStatus: structureResult.status,
        textChannels: structureResult.textChannels,
        categories: structureResult.categories,
        roles: structureResult.roles,
        panels: panelsResult.value.map((panel) =>
            toDashboardTicketPanel(panel, {
                channelsById: structureResult.channelsById,
            })
        ),
    };
}

export async function updateDashboardTicketPanel(
    request: Request,
    input: DashboardTicketPanelUpdateInput
): Promise<DashboardTicketPanelUpdateResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveTicketsActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) {
        return { type: 'bot-token-missing' };
    }

    const payloadResult = normalizePanelPayload(input);

    if (payloadResult.type === 'invalid-input') {
        return payloadResult;
    }

    const sendResult = await sendFluxerBotGuildChannelMessage({
        botToken,
        guildId: guildPageData.guild.id,
        channelId: payloadResult.channelId,
        embeds: [
            {
                title: payloadResult.title,
                description: payloadResult.config.description,
                color: 0x12d8c4,
                footer: {
                    text: `React with ${payloadResult.config.openEmoji} to open a ticket.`,
                },
            },
        ],
    });

    if (sendResult.isErr()) {
        return { type: 'message-send-error' };
    }

    const reactionResult = await reactFluxerBotGuildChannelMessage({
        botToken,
        guildId: guildPageData.guild.id,
        channelId: payloadResult.channelId,
        messageId: sendResult.value.id,
        emoji: payloadResult.config.openEmoji,
    });
    const config: DashboardTicketPanelConfig = {
        ...payloadResult.config,
        syncStatus: reactionResult.isOk() ? 'active' : 'stale',
    };
    const database = getWebDatabaseClient();
    const panelResult = input.panelId
        ? await updateTicketPanel(database.db, {
              guildId: guildPageData.guild.id,
              panelId: input.panelId,
              channelId: payloadResult.channelId,
              messageId: sendResult.value.id,
              title: payloadResult.title,
              enabled: payloadResult.enabled,
              config,
          })
        : await createTicketPanel(database.db, {
              guildId: guildPageData.guild.id,
              channelId: payloadResult.channelId,
              messageId: sendResult.value.id,
              title: payloadResult.title,
              enabled: payloadResult.enabled,
              config,
          });

    if (panelResult.isErr()) {
        return mapRepositoryError(panelResult.error);
    }

    const structureResult = await loadTicketsStructure(guildPageData.guild.id);
    const panel = toDashboardTicketPanel(panelResult.value, {
        channelsById: structureResult.channelsById,
    });
    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardTicketsFeature,
        action: 'panel.published',
        actorUserId: actorResult.actorUserId,
        targetId: panelResult.value.id,
        metadata: {
            panelId: panelResult.value.id,
            channelId: panelResult.value.channelId,
            messageId: panelResult.value.messageId,
            enabled: panelResult.value.enabled,
            syncStatus: panel.config.syncStatus,
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return { type: 'updated', panel };
}

export async function deleteDashboardTicketPanel(
    request: Request,
    input: DashboardTicketPanelDeleteInput
): Promise<DashboardTicketPanelDeleteResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveTicketsActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const structureResult = await loadTicketsStructure(guildPageData.guild.id);
    const database = getWebDatabaseClient();
    const panelResult = await deleteTicketPanel(database.db, {
        guildId: guildPageData.guild.id,
        panelId: input.panelId,
    });

    if (panelResult.isErr()) {
        return mapRepositoryError(panelResult.error);
    }

    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardTicketsFeature,
        action: 'panel.deleted',
        actorUserId: actorResult.actorUserId,
        targetId: panelResult.value.id,
        metadata: {
            panelId: panelResult.value.id,
            channelId: panelResult.value.channelId,
            messageId: panelResult.value.messageId,
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'deleted',
        panel: toDashboardTicketPanel(panelResult.value, {
            channelsById: structureResult.channelsById,
        }),
    };
}

async function loadTicketsStructure(guildId: string) {
    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) {
        return emptyStructureResult('bot-token-missing' as const);
    }

    const structureResult = await readFluxerBotGuildStructure({
        botToken,
        guildId,
    });

    if (structureResult.isErr()) {
        return emptyStructureResult('fetch-failed' as const);
    }

    const categories = toDashboardCategories(structureResult.value.categories);
    const categoriesById = new Map(categories.map((category) => [category.id, category]));
    const textChannels = toDashboardChannels(structureResult.value.channels, categoriesById);
    const roles = toDashboardRoles(structureResult.value.roles);

    return {
        status: 'available' as const,
        textChannels,
        categories,
        roles,
        channelsById: new Map(textChannels.map((channel) => [channel.id, channel])),
    };
}

function emptyStructureResult(status: Exclude<DashboardTicketsStructureReadStatus, 'available'>) {
    return {
        status,
        textChannels: [],
        categories: [],
        roles: [],
        channelsById: new Map<string, DashboardTicketChannel>(),
    };
}

function normalizePanelPayload(input: DashboardTicketPanelUpdateInput):
    | {
          type: 'valid';
          channelId: string;
          title: string;
          enabled: boolean;
          config: DashboardTicketPanelConfig;
      }
    | { type: 'invalid-input'; field: string } {
    const channelId = input.channelId.trim();
    const title = input.title.trim();
    const openEmoji = input.openEmoji?.trim() || defaultPanelConfig.openEmoji;
    const maxOpenPerUser = input.maxOpenPerUser ?? defaultPanelConfig.maxOpenPerUser;

    if (!channelId) return { type: 'invalid-input', field: 'channelId' };
    if (!title) return { type: 'invalid-input', field: 'title' };
    if (!openEmoji) return { type: 'invalid-input', field: 'openEmoji' };
    if (!Number.isInteger(maxOpenPerUser) || maxOpenPerUser < 1 || maxOpenPerUser > 10) {
        return { type: 'invalid-input', field: 'maxOpenPerUser' };
    }

    return {
        type: 'valid',
        channelId,
        title,
        enabled: input.enabled ?? true,
        config: {
            description: input.description?.trim() || defaultPanelConfig.description,
            openEmoji,
            openEmojiKey: `unicode:${openEmoji}`,
            ticketCategoryId: input.ticketCategoryId?.trim() || '',
            staffRoleIds: [...new Set((input.staffRoleIds ?? []).map((roleId) => roleId.trim()).filter(Boolean))],
            ticketNameTemplate: input.ticketNameTemplate?.trim() || defaultPanelConfig.ticketNameTemplate,
            maxOpenPerUser,
            privateTickets: input.privateTickets ?? defaultPanelConfig.privateTickets,
            syncStatus: 'active',
        },
    };
}

function toDashboardCategories(categories: FluxerGuildChannel[]): DashboardTicketCategory[] {
    return categories
        .map((category) => ({
            id: category.id,
            name: category.name ?? category.id,
            position: category.position ?? 0,
        }))
        .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
}

function toDashboardChannels(
    channels: FluxerGuildChannel[],
    categoriesById: ReadonlyMap<string, DashboardTicketCategory>
): DashboardTicketChannel[] {
    return channels
        .filter((channel) => textChannelTypes.has(channel.type))
        .map((channel) => ({
            id: channel.id,
            name: channel.name ?? channel.id,
            type: channel.type,
            position: channel.position ?? 0,
            ...(channel.parentId ? { parentId: channel.parentId } : {}),
            ...(channel.parentId && categoriesById.get(channel.parentId)
                ? { parentName: categoriesById.get(channel.parentId)?.name }
                : {}),
        }))
        .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
}

function toDashboardRoles(roles: FluxerGuildRole[]): DashboardTicketRole[] {
    return roles
        .map((role) => ({
            id: role.id,
            name: role.name,
            position: role.position,
        }))
        .sort((left, right) => right.position - left.position || left.name.localeCompare(right.name));
}

function toDashboardTicketPanel(
    record: TicketPanelRecord,
    lookups: { channelsById: ReadonlyMap<string, DashboardTicketChannel> }
): DashboardTicketPanel {
    const channel = lookups.channelsById.get(record.channelId);

    return {
        id: record.id,
        channelId: record.channelId,
        ...(channel ? { channelName: channel.name } : {}),
        ...(record.messageId ? { messageId: record.messageId } : {}),
        title: record.title,
        enabled: record.enabled,
        config: normalizeStoredConfig(record.config),
        updatedAt: record.updatedAt.toISOString(),
    };
}

function normalizeStoredConfig(config: Record<string, unknown>): DashboardTicketPanelConfig {
    return {
        ...defaultPanelConfig,
        description: readString(config.description, defaultPanelConfig.description),
        openEmoji: readString(config.openEmoji, defaultPanelConfig.openEmoji),
        openEmojiKey: readString(config.openEmojiKey, defaultPanelConfig.openEmojiKey),
        ticketCategoryId: readString(config.ticketCategoryId, ''),
        staffRoleIds: Array.isArray(config.staffRoleIds)
            ? config.staffRoleIds.filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0)
            : [],
        ticketNameTemplate: readString(config.ticketNameTemplate, defaultPanelConfig.ticketNameTemplate),
        maxOpenPerUser:
            typeof config.maxOpenPerUser === 'number' && Number.isInteger(config.maxOpenPerUser)
                ? config.maxOpenPerUser
                : defaultPanelConfig.maxOpenPerUser,
        privateTickets: typeof config.privateTickets === 'boolean' ? config.privateTickets : true,
        syncStatus: config.syncStatus === 'stale' ? 'stale' : 'active',
    };
}

function readString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardTicketsErrorResult {
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

function mapRepositoryError(error: { type: string; field?: string }) {
    switch (error.type) {
        case 'missing-input':
        case 'invalid-value':
            return { type: 'invalid-input' as const, field: error.field ?? 'unknown' };
        case 'not-found':
            return { type: 'not-found' as const };
        case 'database-error':
        default:
            return { type: 'database-error' as const };
    }
}

type TicketsActor =
    | { type: 'actor'; actorUserId: string; metadata: Record<string, string> }
    | { type: 'auth-required' }
    | { type: 'database-error' };

async function resolveTicketsActor(request: Request): Promise<TicketsActor> {
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
