import { createServerFn } from '@tanstack/react-start';
import { type } from 'arktype';

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

const dashboardGuildRouteInput = type({
    guildId: 'string',
});

const dashboardAutoroleRuleUpdateRouteInput = type({
    guildId: 'string',
    roleId: 'string',
    'name?': 'string',
    'enabled?': 'boolean',
});

const dashboardAutoroleRuleDeleteRouteInput = type({
    guildId: 'string',
    roleId: 'string',
});

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
    const parsed = dashboardGuildRouteInput(input);

    if (parsed instanceof type.errors) {
        return { guildId: '' };
    }

    return parsed;
}

function validateDashboardAutoroleRuleUpdateRouteInput(input: unknown): DashboardAutoroleRuleUpdateRouteInput {
    const parsed = dashboardAutoroleRuleUpdateRouteInput(input);

    if (parsed instanceof type.errors) {
        return { guildId: '', roleId: '' };
    }

    return parsed;
}

function validateDashboardAutoroleRuleDeleteRouteInput(input: unknown): DashboardAutoroleRuleDeleteRouteInput {
    const parsed = dashboardAutoroleRuleDeleteRouteInput(input);

    if (parsed instanceof type.errors) {
        return { guildId: '', roleId: '' };
    }

    return parsed;
}
