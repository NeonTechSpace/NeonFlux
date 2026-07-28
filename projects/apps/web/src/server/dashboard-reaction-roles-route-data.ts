import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardReactionRoleMutationResult,
    DashboardReactionRoleReadResult,
} from './dashboard-reaction-roles.server.js';

export const readDashboardReactionRolesRouteData = createServerFn({ method: 'GET' })
    .validator(readGuildInput)
    .handler(async ({ data }): Promise<DashboardReactionRoleReadResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardReactionRoles } = await import('./dashboard-reaction-roles.server.js');
        setResponseHeader('Cache-Control', 'no-store');
        return loadDashboardReactionRoles(getRequest(), data.guildId);
    });

export const publishDashboardReactionRoleRouteData = createServerFn({ method: 'POST' })
    .validator(panelMutationInput)
    .handler(async ({ data }): Promise<DashboardReactionRoleMutationResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { publishDashboardReactionRolePanel } = await import('./dashboard-reaction-roles.server.js');
        setResponseHeader('Cache-Control', 'no-store');
        return publishDashboardReactionRolePanel(getRequest(), data);
    });

export const updateDashboardReactionRoleRouteData = createServerFn({ method: 'POST' })
    .validator(panelUpdateInput)
    .handler(async ({ data }): Promise<DashboardReactionRoleMutationResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardReactionRolePanel } = await import('./dashboard-reaction-roles.server.js');
        setResponseHeader('Cache-Control', 'no-store');
        return updateDashboardReactionRolePanel(getRequest(), data);
    });

export const deactivateDashboardReactionRoleRouteData = createServerFn({ method: 'POST' })
    .validator(deactivateInput)
    .handler(async ({ data }): Promise<DashboardReactionRoleMutationResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { deactivateDashboardReactionRolePanel } = await import('./dashboard-reaction-roles.server.js');
        setResponseHeader('Cache-Control', 'no-store');
        return deactivateDashboardReactionRolePanel(getRequest(), data);
    });

function readGuildInput(input: unknown): { guildId: string } {
    const value = record(input);
    return { guildId: string(value.guildId) };
}

function panelMutationInput(input: unknown) {
    const value = record(input);
    return {
        channelId: string(value.channelId),
        guildId: string(value.guildId),
        name: string(value.name),
        payload: value.payload,
        requestKey: string(value.requestKey),
    };
}

function panelUpdateInput(input: unknown) {
    const value = record(input);
    return {
        ...panelMutationInput(input),
        expectedUpdatedAt: string(value.expectedUpdatedAt),
        panelId: string(value.panelId),
    };
}

function deactivateInput(input: unknown) {
    const value = record(input);
    return {
        deleteMessage: value.deleteMessage === true,
        expectedUpdatedAt: string(value.expectedUpdatedAt),
        guildId: string(value.guildId),
        panelId: string(value.panelId),
        requestKey: string(value.requestKey),
        revokeOwnedRoles: value.revokeOwnedRoles === true,
    };
}

function record(input: unknown): Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
}

function string(value: unknown): string {
    return typeof value === 'string' ? value : '';
}
