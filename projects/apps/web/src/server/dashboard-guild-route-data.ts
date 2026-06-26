import { redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardCommandPrefixUpdateResult,
    DashboardCommandSettings,
    DashboardCommandSettingsPageDataResult,
} from './dashboard-command-settings.server.js';
import type {
    DashboardAuditEventsResult,
    DashboardAuditSearchScope,
    DashboardPostMessageResult,
    DashboardPostingChannelsResult,
} from './dashboard-posting.server.js';
import type { DashboardGuildOverviewResult } from './dashboard-overview.server.js';

const fluxerLoginPath = '/auth/fluxer/login';
const dashboardUnavailableMessage = 'NeonFlux dashboard unavailable.';
const deploymentConfigUnavailableMessage = 'NeonFlux deployment config unavailable.';
const communityUnavailableMessage = 'This community is not available for this account.';

export type DashboardGuildRouteData =
    | {
          type: 'guild';
          mode: 'single' | 'multi';
          guild: {
              id: string;
              name: string;
              iconUrl?: string;
          };
          commandSettings: DashboardCommandSettings;
      }
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

export type DashboardGuildRouteResult = DashboardGuildRouteData | { type: 'auth-required' };

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
    embeds?: unknown[];
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

export function toDashboardGuildRouteResult(data: DashboardCommandSettingsPageDataResult): DashboardGuildRouteResult {
    switch (data.type) {
        case 'guild':
        case 'single-unauthorized':
            return data;

        case 'auth-required':
            return { type: 'auth-required' };

        case 'not-found':
            return {
                type: 'unavailable',
                status: 404,
                title: 'Community unavailable',
                message: communityUnavailableMessage,
            };

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
    }
}

export const loadDashboardGuildRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardGuildRouteData> => {
        const { getRequest, setResponseHeader, setResponseStatus } = await import('@tanstack/react-start/server');
        const { loadDashboardCommandSettingsPageData } = await import('./dashboard-command-settings.server.js');
        const routeResult = toDashboardGuildRouteResult(
            await loadDashboardCommandSettingsPageData(getRequest(), data.guildId)
        );

        setResponseHeader('Cache-Control', 'no-store');

        const routeData = resolveDashboardGuildRouteResult(routeResult);

        if (routeData.type === 'unavailable') {
            setResponseStatus(routeData.status);
        }

        return routeData;
    });

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

export const readDashboardAuditEventsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardAuditEventsRouteInput)
    .handler(async ({ data }): Promise<DashboardAuditEventsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardGuildAuditEventsPage } = await import('./dashboard-posting.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardGuildAuditEventsPage(getRequest(), data);
    });

export const readDashboardGuildOverviewRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardGuildOverviewResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardGuildOverview } = await import('./dashboard-overview.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardGuildOverview(getRequest(), data.guildId);
    });

export const readDashboardPostingChannelsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardPostingChannelsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardGuildPostingChannels } = await import('./dashboard-posting.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardGuildPostingChannels(getRequest(), data.guildId);
    });

export function toDashboardCommandSettingsReadResult(
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
        return { guildId: '', channelId: '' };
    }

    const payload = input as Record<string, unknown>;
    const guildId = payload.guildId;
    const channelId = payload.channelId;
    const content = payload.content;
    const embeds = payload.embeds;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
        channelId: typeof channelId === 'string' ? channelId : '',
        ...(typeof content === 'string' ? { content } : {}),
        ...(Array.isArray(embeds) ? { embeds } : {}),
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
