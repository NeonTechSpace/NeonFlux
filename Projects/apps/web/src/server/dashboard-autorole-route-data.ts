import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardAutoroleRuleDeleteResult,
    DashboardAutoroleRuleUpdateResult,
    DashboardAutoroleSettingsResult,
} from './dashboard-autorole.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

type DashboardAutoroleRuleUpdateRouteInput = {
    guildId: string;
    roleId: string;
    name?: string;
    enabled?: boolean;
};

type DashboardAutoroleRuleDeleteRouteInput = {
    guildId: string;
    roleId: string;
};

export const readDashboardAutoroleSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardAutoroleSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardAutoroleSettings } = await import('./dashboard-autorole.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardAutoroleSettings(getRequest(), data.guildId);
    });

export const updateDashboardAutoroleRuleRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardAutoroleRuleUpdateRouteInput)
    .handler(async ({ data }): Promise<DashboardAutoroleRuleUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardAutoroleRule } = await import('./dashboard-autorole.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardAutoroleRule(getRequest(), data);
    });

export const deleteDashboardAutoroleRuleRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardAutoroleRuleDeleteRouteInput)
    .handler(async ({ data }): Promise<DashboardAutoroleRuleDeleteResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { deleteDashboardAutoroleRule } = await import('./dashboard-autorole.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return deleteDashboardAutoroleRule(getRequest(), data);
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

function validateDashboardAutoroleRuleUpdateRouteInput(input: unknown): DashboardAutoroleRuleUpdateRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', roleId: '' };
    }

    const payload = input as Record<string, unknown>;
    const guildId = payload.guildId;
    const roleId = payload.roleId;
    const name = payload.name;
    const enabled = payload.enabled;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
        roleId: typeof roleId === 'string' ? roleId : '',
        ...(typeof name === 'string' ? { name } : {}),
        ...(typeof enabled === 'boolean' ? { enabled } : {}),
    };
}

function validateDashboardAutoroleRuleDeleteRouteInput(input: unknown): DashboardAutoroleRuleDeleteRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', roleId: '' };
    }

    const payload = input as Record<string, unknown>;
    const guildId = payload.guildId;
    const roleId = payload.roleId;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
        roleId: typeof roleId === 'string' ? roleId : '',
    };
}
