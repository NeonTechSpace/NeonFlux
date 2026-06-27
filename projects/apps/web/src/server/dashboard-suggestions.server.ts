import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    deleteSuggestionBoard,
    listSuggestionBoardsByGuildId,
    recordBotActionEvent,
    upsertSuggestionBoard,
} from '@neonflux/db';
import type { SuggestionBoardRecord } from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type { FluxerGuildChannel } from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardSuggestionChannel = {
    id: string;
    name: string;
    type: number;
    position: number;
    parentId?: string;
    parentName?: string;
};

export type DashboardSuggestionBoard = {
    id: string;
    name: string;
    channelId: string;
    channelName?: string;
    enabled: boolean;
    updatedAt: string;
};

export type DashboardSuggestionsStructureReadStatus = 'available' | 'bot-token-missing' | 'fetch-failed';

export type DashboardSuggestionsSettingsResult =
    | {
          type: 'settings';
          structureReadStatus: DashboardSuggestionsStructureReadStatus;
          channels: DashboardSuggestionChannel[];
          boards: DashboardSuggestionBoard[];
      }
    | DashboardSuggestionsErrorResult;

export type DashboardSuggestionBoardUpdateInput = {
    guildId: string;
    name: string;
    channelId: string;
    enabled?: boolean;
};

export type DashboardSuggestionBoardDeleteInput = {
    guildId: string;
    name: string;
};

export type DashboardSuggestionBoardUpdateResult =
    | {
          type: 'updated';
          board: DashboardSuggestionBoard;
      }
    | { type: 'invalid-input'; field: string }
    | DashboardSuggestionsErrorResult;

export type DashboardSuggestionBoardDeleteResult =
    | {
          type: 'deleted';
          board: DashboardSuggestionBoard;
      }
    | { type: 'invalid-input'; field: string }
    | DashboardSuggestionsErrorResult;

type DashboardSuggestionsErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;

const dashboardSuggestionsFeature = 'suggestions';
const textChannelTypes = new Set([0, 5]);

export async function loadDashboardSuggestionsSettings(
    request: Request,
    guildId: string
): Promise<DashboardSuggestionsSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const database = getWebDatabaseClient();
    const boardsResult = await listSuggestionBoardsByGuildId(database.db, {
        guildId: guildPageData.guild.id,
    });

    if (boardsResult.isErr()) {
        return { type: 'database-error' };
    }

    const structureResult = await loadDashboardSuggestionsStructure(guildPageData.guild.id);

    return {
        type: 'settings',
        structureReadStatus: structureResult.status,
        channels: structureResult.channels,
        boards: boardsResult.value.map((board) =>
            toDashboardSuggestionBoard(board, {
                channelsById: structureResult.channelsById,
            })
        ),
    };
}

export async function updateDashboardSuggestionBoard(
    request: Request,
    input: DashboardSuggestionBoardUpdateInput
): Promise<DashboardSuggestionBoardUpdateResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveSuggestionsActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const boardResult = await upsertSuggestionBoard(database.db, {
        guildId: guildPageData.guild.id,
        name: input.name,
        channelId: input.channelId,
        enabled: input.enabled ?? true,
    });

    if (boardResult.isErr()) {
        return mapRepositoryError(boardResult.error);
    }

    const structureResult = await loadDashboardSuggestionsStructure(guildPageData.guild.id);
    const board = toDashboardSuggestionBoard(boardResult.value, {
        channelsById: structureResult.channelsById,
    });
    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardSuggestionsFeature,
        action: 'board.updated',
        actorUserId: actorResult.actorUserId,
        targetId: boardResult.value.name,
        metadata: {
            boardName: boardResult.value.name,
            channelId: boardResult.value.channelId,
            ...(board.channelName ? { channelName: board.channelName } : {}),
            enabled: boardResult.value.enabled,
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'updated',
        board,
    };
}

export async function deleteDashboardSuggestionBoard(
    request: Request,
    input: DashboardSuggestionBoardDeleteInput
): Promise<DashboardSuggestionBoardDeleteResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveSuggestionsActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const structureResult = await loadDashboardSuggestionsStructure(guildPageData.guild.id);
    const boardResult = await deleteSuggestionBoard(database.db, {
        guildId: guildPageData.guild.id,
        name: input.name,
    });

    if (boardResult.isErr()) {
        return mapRepositoryError(boardResult.error);
    }

    const board = toDashboardSuggestionBoard(boardResult.value, {
        channelsById: structureResult.channelsById,
    });
    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardSuggestionsFeature,
        action: 'board.deleted',
        actorUserId: actorResult.actorUserId,
        targetId: boardResult.value.name,
        metadata: {
            boardName: boardResult.value.name,
            channelId: boardResult.value.channelId,
            ...(board.channelName ? { channelName: board.channelName } : {}),
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'deleted',
        board,
    };
}

async function loadDashboardSuggestionsStructure(guildId: string) {
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

    const categories = structureResult.value.categories.map((category) => ({
        id: category.id,
        name: category.name ?? category.id,
        position: category.position ?? 0,
    }));
    const categoriesById = new Map(categories.map((category) => [category.id, category]));
    const channels = toDashboardChannels(structureResult.value.channels, categoriesById);

    return {
        status: 'available' as const,
        channels,
        channelsById: new Map(channels.map((channel) => [channel.id, channel])),
    };
}

function emptyStructureResult(status: Exclude<DashboardSuggestionsStructureReadStatus, 'available'>) {
    return {
        status,
        channels: [],
        channelsById: new Map<string, DashboardSuggestionChannel>(),
    };
}

function toDashboardChannels(
    channels: FluxerGuildChannel[],
    categoriesById: ReadonlyMap<string, { id: string; name: string; position: number }>
): DashboardSuggestionChannel[] {
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

function toDashboardSuggestionBoard(
    record: SuggestionBoardRecord,
    lookups: { channelsById: ReadonlyMap<string, DashboardSuggestionChannel> }
): DashboardSuggestionBoard {
    const channel = lookups.channelsById.get(record.channelId);

    return {
        id: record.id,
        name: record.name,
        channelId: record.channelId,
        ...(channel ? { channelName: channel.name } : {}),
        enabled: record.enabled,
        updatedAt: record.updatedAt.toISOString(),
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardSuggestionsErrorResult {
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

type SuggestionsActor =
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' };

async function resolveSuggestionsActor(request: Request): Promise<SuggestionsActor> {
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
