import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardTicketPanelDeleteResult,
    DashboardTicketPanelUpdateResult,
    DashboardTicketsSettingsResult,
} from './dashboard-tickets.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

type DashboardTicketPanelUpdateRouteInput = {
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

type DashboardTicketPanelDeleteRouteInput = {
    guildId: string;
    panelId: string;
};

export const readDashboardTicketsSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardTicketsSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardTicketsSettings } = await import('./dashboard-tickets.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardTicketsSettings(getRequest(), data.guildId);
    });

export const updateDashboardTicketPanelRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardTicketPanelUpdateRouteInput)
    .handler(async ({ data }): Promise<DashboardTicketPanelUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardTicketPanel } = await import('./dashboard-tickets.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardTicketPanel(getRequest(), data);
    });

export const deleteDashboardTicketPanelRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardTicketPanelDeleteRouteInput)
    .handler(async ({ data }): Promise<DashboardTicketPanelDeleteResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { deleteDashboardTicketPanel } = await import('./dashboard-tickets.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return deleteDashboardTicketPanel(getRequest(), data);
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

function validateDashboardTicketPanelUpdateRouteInput(input: unknown): DashboardTicketPanelUpdateRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', channelId: '', title: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        panelId: readOptionalString(payload.panelId),
        channelId: readString(payload.channelId),
        title: readString(payload.title),
        description: readOptionalString(payload.description),
        openEmoji: readOptionalString(payload.openEmoji),
        ticketCategoryId: readOptionalString(payload.ticketCategoryId),
        staffRoleIds: Array.isArray(payload.staffRoleIds)
            ? payload.staffRoleIds.filter((roleId): roleId is string => typeof roleId === 'string')
            : [],
        ticketNameTemplate: readOptionalString(payload.ticketNameTemplate),
        maxOpenPerUser: typeof payload.maxOpenPerUser === 'number' ? payload.maxOpenPerUser : undefined,
        privateTickets: typeof payload.privateTickets === 'boolean' ? payload.privateTickets : undefined,
        enabled: typeof payload.enabled === 'boolean' ? payload.enabled : undefined,
    };
}

function validateDashboardTicketPanelDeleteRouteInput(input: unknown): DashboardTicketPanelDeleteRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', panelId: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        panelId: readString(payload.panelId),
    };
}

function readString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}
