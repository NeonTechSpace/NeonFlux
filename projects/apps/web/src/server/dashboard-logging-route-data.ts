import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardLoggingDestinationDeleteResult,
    DashboardLoggingDestinationUpdateResult,
    DashboardLoggingSettingsResult,
} from './dashboard-logging.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

type DashboardLoggingDestinationUpdateRouteInput = {
    guildId: string;
    eventGroup: string;
    channelId: string;
    enabled?: boolean;
};

type DashboardLoggingDestinationDeleteRouteInput = {
    guildId: string;
    eventGroup: string;
};

export const readDashboardLoggingSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardLoggingSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardLoggingSettings } = await import('./dashboard-logging.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardLoggingSettings(getRequest(), data.guildId);
    });

export const updateDashboardLoggingDestinationRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardLoggingDestinationUpdateRouteInput)
    .handler(async ({ data }): Promise<DashboardLoggingDestinationUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardLoggingDestination } = await import('./dashboard-logging.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardLoggingDestination(getRequest(), data);
    });

export const deleteDashboardLoggingDestinationRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardLoggingDestinationDeleteRouteInput)
    .handler(async ({ data }): Promise<DashboardLoggingDestinationDeleteResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { deleteDashboardLoggingDestination } = await import('./dashboard-logging.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return deleteDashboardLoggingDestination(getRequest(), data);
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

function validateDashboardLoggingDestinationUpdateRouteInput(
    input: unknown
): DashboardLoggingDestinationUpdateRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', eventGroup: '', channelId: '' };
    }

    const payload = input as Record<string, unknown>;
    const guildId = payload.guildId;
    const eventGroup = payload.eventGroup;
    const channelId = payload.channelId;
    const enabled = payload.enabled;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
        eventGroup: typeof eventGroup === 'string' ? eventGroup : '',
        channelId: typeof channelId === 'string' ? channelId : '',
        ...(typeof enabled === 'boolean' ? { enabled } : {}),
    };
}

function validateDashboardLoggingDestinationDeleteRouteInput(
    input: unknown
): DashboardLoggingDestinationDeleteRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', eventGroup: '' };
    }

    const payload = input as Record<string, unknown>;
    const guildId = payload.guildId;
    const eventGroup = payload.eventGroup;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
        eventGroup: typeof eventGroup === 'string' ? eventGroup : '',
    };
}
