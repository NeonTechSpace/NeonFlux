import { redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { parseOutgoingMessage } from '@neonflux/messaging';
import type { OutgoingEmbed } from '@neonflux/messaging';

import type {
    DashboardCommandPrefixUpdateResult,
    DashboardCommandSettings,
    DashboardCommandSettingsPageDataResult,
} from './dashboard-command-settings.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import type { DashboardAuditEventsResult, DashboardAuditSearchScope } from './dashboard-audit-events-model.js';
import type {
    DashboardPostMessageResult,
    DashboardPostingCatalogResult,
    DashboardPostingOperationsResult,
    DashboardPostingUnknownResolutionResult,
} from './dashboard-posting.server.js';
import type { DashboardGuildOverviewResult } from './dashboard-overview-model.js';

const fluxerLoginPath = '/auth/fluxer/login';
const dashboardUnavailableMessage = 'NeonFlux dashboard unavailable.';
const deploymentConfigUnavailableMessage = 'NeonFlux deployment config unavailable.';

export type DashboardGuildRouteData =
    | Extract<DashboardGuildPageDataResult, { type: 'guild' }>
    | {
          type: 'single-unauthorized';
          configuredGuildId: string;
          configuredGuildName: string;
      }
    | {
          type: 'unavailable';
          status: 404 | 500 | 502 | 503;
          title: string;
          message: string;
      };

export type DashboardGuildRouteResult =
    | DashboardGuildRouteData
    | { type: 'auth-required' }
    | { type: 'dashboard-redirect' };

type DashboardGuildRouteInput = {
    guildId: string;
};

type DashboardCommandPrefixUpdateRouteInput = {
    guildId: string;
    prefix: string;
};

type DashboardPostMessageRouteInput = {
    guildId: string;
    channelId: string;
    content?: string;
    embeds?: OutgoingEmbed[];
    requestKey: string;
    retryOfOperationId?: string;
};

type DashboardPostingUnknownResolutionRouteInput = {
    guildId: string;
    operationId: string;
    resolution: 'reported_not_seen' | 'reported_seen';
};

type DashboardAuditEventsRouteInput = {
    guildId: string;
    cursor?: string;
    limit?: number;
    search?: string;
    searchScope?: DashboardAuditSearchScope;
    searchOffsetMinutes?: number;
};

export type DashboardCommandSettingsReadResult =
    | {
          type: 'settings';
          commandSettings: DashboardCommandSettings;
      }
    | {
          type: 'auth-required';
      }
    | {
          type: 'not-found';
      }
    | {
          type: 'deployment-config-not-found';
      }
    | {
          type: 'database-error';
      }
    | {
          type: 'guild-lookup-failed';
      };

export function toDashboardGuildRouteResult(data: DashboardGuildPageDataResult): DashboardGuildRouteResult {
    switch (data.type) {
        case 'guild':
            return data;

        case 'single-unauthorized':
        case 'not-found':
            return { type: 'dashboard-redirect' };

        case 'auth-required':
            return { type: 'auth-required' };

        case 'database-error':
            return {
                type: 'unavailable',
                status: 500,
                title: 'Dashboard unavailable',
                message: dashboardUnavailableMessage,
            };

        case 'deployment-config-not-found':
            return {
                type: 'unavailable',
                status: 503,
                title: 'Dashboard unavailable',
                message: deploymentConfigUnavailableMessage,
            };

        case 'guild-lookup-failed':
            return {
                type: 'unavailable',
                status: 502,
                title: 'Dashboard unavailable',
                message: dashboardUnavailableMessage,
            };
    }
}

export function resolveDashboardGuildRouteResult(routeResult: DashboardGuildRouteResult): DashboardGuildRouteData {
    switch (routeResult.type) {
        case 'guild':
        case 'single-unauthorized':
        case 'unavailable':
            return routeResult;

        case 'auth-required':
            throw redirect({
                to: fluxerLoginPath,
                reloadDocument: true,
                statusCode: 302,
            });

        case 'dashboard-redirect':
            throw redirect({
                to: '/dashboard',
                replace: true,
                statusCode: 302,
            });
    }
}

export const loadDashboardGuildRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardGuildRouteData> => {
        const { getRequest, setResponseHeader, setResponseStatus } = await import('@tanstack/react-start/server');
        const { loadDashboardGuildPageData } = await import('./dashboard-guild-page.server.js');
        const routeResult = toDashboardGuildRouteResult(await loadDashboardGuildPageData(getRequest(), data.guildId));

        setResponseHeader('Cache-Control', 'no-store');

        const routeData = resolveDashboardGuildRouteResult(routeResult);

        if (routeData.type === 'unavailable') {
            setResponseStatus(routeData.status);
        }

        return routeData;
    });

export async function redirectDashboardGuildSubrouteFallback(
    guildId: string,
    loadGuildRoute: (input: {
        data: DashboardGuildRouteInput;
    }) => Promise<DashboardGuildRouteData> = loadDashboardGuildRouteData
): Promise<never> {
    await loadGuildRoute({ data: { guildId } });

    throw redirect({
        to: '/dashboard/$guildId',
        params: { guildId },
        replace: true,
        statusCode: 302,
    });
}

export const readDashboardCommandSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardCommandSettingsReadResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardCommandSettingsPageData } = await import('./dashboard-command-settings.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return toDashboardCommandSettingsReadResult(
            await loadDashboardCommandSettingsPageData(getRequest(), data.guildId)
        );
    });

export const updateDashboardCommandPrefixRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardCommandPrefixUpdateRouteInput)
    .handler(async ({ data }): Promise<DashboardCommandPrefixUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardGuildCommandPrefix } = await import('./dashboard-command-settings.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardGuildCommandPrefix(getRequest(), data);
    });

export const postDashboardMessageRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardPostMessageRouteInput)
    .handler(async ({ data }): Promise<DashboardPostMessageResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { postDashboardGuildMessage } = await import('./dashboard-posting.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return postDashboardGuildMessage(getRequest(), data);
    });

export const resolveDashboardPostingUnknownRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardPostingUnknownResolutionRouteInput)
    .handler(async ({ data }): Promise<DashboardPostingUnknownResolutionResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { resolveDashboardGuildPostingUnknown } = await import('./dashboard-posting.server.js');

        setResponseHeader('Cache-Control', 'no-store');
        return resolveDashboardGuildPostingUnknown(getRequest(), data);
    });

export const readDashboardPostingOperationsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardPostingOperationsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardGuildPostingOperations } = await import('./dashboard-posting.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardGuildPostingOperations(getRequest(), data.guildId);
    });

export const readDashboardGuildOverviewRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardGuildOverviewResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardGuildOverview } = await import('./dashboard-overview.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardGuildOverview(getRequest(), data.guildId);
    });

export const readDashboardAuditEventsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardAuditEventsRouteInput)
    .handler(async ({ data }): Promise<DashboardAuditEventsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardGuildAuditEventsPage } = await import('./dashboard-audit-events.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardGuildAuditEventsPage(getRequest(), data);
    });

export const readDashboardPostingCatalogRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardPostingCatalogResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardGuildPostingCatalog } = await import('./dashboard-posting.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardGuildPostingCatalog(getRequest(), data.guildId);
    });

function toDashboardCommandSettingsReadResult(
    data: DashboardCommandSettingsPageDataResult
): DashboardCommandSettingsReadResult {
    switch (data.type) {
        case 'guild':
            return {
                type: 'settings',
                commandSettings: data.commandSettings,
            };

        case 'auth-required':
        case 'deployment-config-not-found':
        case 'database-error':
        case 'guild-lookup-failed':
        case 'not-found':
            return { type: data.type };

        case 'single-unauthorized':
            return { type: 'not-found' };
    }
}

export function getGuildIdParam(params: unknown): string {
    if (!params || typeof params !== 'object') {
        return '';
    }

    const guildId = (params as Record<string, unknown>).guildId;

    return typeof guildId === 'string' ? guildId : '';
}

function validateDashboardGuildRouteInput(input: unknown): DashboardGuildRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '' };
    }

    const guildId = (input as Record<string, unknown>).guildId;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
    };
}

function validateDashboardCommandPrefixUpdateRouteInput(input: unknown): DashboardCommandPrefixUpdateRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', prefix: '' };
    }

    const guildId = (input as Record<string, unknown>).guildId;
    const prefix = (input as Record<string, unknown>).prefix;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
        prefix: typeof prefix === 'string' ? prefix : '',
    };
}

function validateDashboardPostMessageRouteInput(input: unknown): DashboardPostMessageRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', channelId: '', requestKey: '' };
    }

    const payload = input as Record<string, unknown>;
    const guildId = payload.guildId;
    const channelId = payload.channelId;
    const content = payload.content;
    const embeds = payload.embeds;
    const requestKey = payload.requestKey;
    const retryOfOperationId = payload.retryOfOperationId;
    const message = parseOutgoingMessage({
        ...(typeof content === 'string' ? { content } : {}),
        embeds: Array.isArray(embeds) ? embeds : [],
    });

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
        channelId: typeof channelId === 'string' ? channelId : '',
        ...(message.isOk() && message.value.content ? { content: message.value.content } : {}),
        ...(message.isOk() ? { embeds: message.value.embeds } : {}),
        requestKey: typeof requestKey === 'string' ? requestKey : '',
        ...(typeof retryOfOperationId === 'string' ? { retryOfOperationId } : {}),
    };
}

function validateDashboardPostingUnknownResolutionRouteInput(
    input: unknown
): DashboardPostingUnknownResolutionRouteInput {
    if (!input || typeof input !== 'object') {
        throw new Error('Invalid posting resolution input.');
    }
    const payload = input as Record<string, unknown>;
    if (payload.resolution !== 'reported_seen' && payload.resolution !== 'reported_not_seen') {
        throw new Error('Invalid posting resolution input.');
    }
    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        operationId: typeof payload.operationId === 'string' ? payload.operationId : '',
        resolution: payload.resolution,
    };
}

function validateDashboardAuditEventsRouteInput(input: unknown): DashboardAuditEventsRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '' };
    }

    const payload = input as Record<string, unknown>;
    const guildId = payload.guildId;
    const cursor = payload.cursor;
    const limit = payload.limit;
    const search = payload.search;
    const searchScope = payload.searchScope;
    const searchOffsetMinutes = payload.searchOffsetMinutes;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
        ...(typeof cursor === 'string' ? { cursor } : {}),
        ...(typeof limit === 'number' && Number.isFinite(limit) ? { limit } : {}),
        ...(typeof search === 'string' ? { search } : {}),
        ...(isDashboardAuditSearchScope(searchScope) ? { searchScope } : {}),
        ...(typeof searchOffsetMinutes === 'number' && Number.isFinite(searchOffsetMinutes)
            ? { searchOffsetMinutes }
            : {}),
    };
}

function isDashboardAuditSearchScope(value: unknown): value is DashboardAuditSearchScope {
    return (
        value === 'all' ||
        value === 'event' ||
        value === 'actor' ||
        value === 'channel' ||
        value === 'message' ||
        value === 'time' ||
        value === 'metadata'
    );
}
