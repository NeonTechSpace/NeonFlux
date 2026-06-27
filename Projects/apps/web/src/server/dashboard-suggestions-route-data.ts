import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardSuggestionBoardDeleteResult,
    DashboardSuggestionBoardUpdateResult,
    DashboardSuggestionsSettingsResult,
} from './dashboard-suggestions.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

type DashboardSuggestionBoardUpdateRouteInput = {
    guildId: string;
    name: string;
    channelId: string;
    enabled?: boolean;
};

type DashboardSuggestionBoardDeleteRouteInput = {
    guildId: string;
    name: string;
};

export const readDashboardSuggestionsSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardSuggestionsSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardSuggestionsSettings } = await import('./dashboard-suggestions.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardSuggestionsSettings(getRequest(), data.guildId);
    });

export const updateDashboardSuggestionBoardRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardSuggestionBoardUpdateRouteInput)
    .handler(async ({ data }): Promise<DashboardSuggestionBoardUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardSuggestionBoard } = await import('./dashboard-suggestions.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardSuggestionBoard(getRequest(), data);
    });

export const deleteDashboardSuggestionBoardRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardSuggestionBoardDeleteRouteInput)
    .handler(async ({ data }): Promise<DashboardSuggestionBoardDeleteResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { deleteDashboardSuggestionBoard } = await import('./dashboard-suggestions.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return deleteDashboardSuggestionBoard(getRequest(), data);
    });

function validateDashboardGuildRouteInput(input: unknown): DashboardGuildRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '' };
    }

    const guildId = (input as Record<string, unknown>).guildId;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
    };
}

function validateDashboardSuggestionBoardUpdateRouteInput(input: unknown): DashboardSuggestionBoardUpdateRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', name: '', channelId: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        name: typeof payload.name === 'string' ? payload.name : '',
        channelId: typeof payload.channelId === 'string' ? payload.channelId : '',
        ...(typeof payload.enabled === 'boolean' ? { enabled: payload.enabled } : {}),
    };
}

function validateDashboardSuggestionBoardDeleteRouteInput(input: unknown): DashboardSuggestionBoardDeleteRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', name: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        name: typeof payload.name === 'string' ? payload.name : '',
    };
}
