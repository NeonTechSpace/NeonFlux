import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardVcGeneratorRuleDeleteResult,
    DashboardVcGeneratorRuleUpdateResult,
    DashboardVcGeneratorSettingsResult,
} from './dashboard-vc-generator.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

type DashboardVcGeneratorRuleUpdateRouteInput = {
    guildId: string;
    sourceChannelId: string;
    nameTemplate: string;
    categoryId?: string;
    panelChannelId?: string;
    enabled?: boolean;
};

type DashboardVcGeneratorRuleDeleteRouteInput = {
    guildId: string;
    sourceChannelId: string;
};

export const readDashboardVcGeneratorSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardVcGeneratorSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardVcGeneratorSettings } = await import('./dashboard-vc-generator.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardVcGeneratorSettings(getRequest(), data.guildId);
    });

export const updateDashboardVcGeneratorRuleRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardVcGeneratorRuleUpdateRouteInput)
    .handler(async ({ data }): Promise<DashboardVcGeneratorRuleUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardVcGeneratorRule } = await import('./dashboard-vc-generator.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardVcGeneratorRule(getRequest(), data);
    });

export const deleteDashboardVcGeneratorRuleRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardVcGeneratorRuleDeleteRouteInput)
    .handler(async ({ data }): Promise<DashboardVcGeneratorRuleDeleteResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { deleteDashboardVcGeneratorRule } = await import('./dashboard-vc-generator.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return deleteDashboardVcGeneratorRule(getRequest(), data);
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

function validateDashboardVcGeneratorRuleUpdateRouteInput(input: unknown): DashboardVcGeneratorRuleUpdateRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', sourceChannelId: '', nameTemplate: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        sourceChannelId: typeof payload.sourceChannelId === 'string' ? payload.sourceChannelId : '',
        nameTemplate: typeof payload.nameTemplate === 'string' ? payload.nameTemplate : '',
        ...(typeof payload.categoryId === 'string' ? { categoryId: payload.categoryId } : {}),
        ...(typeof payload.panelChannelId === 'string' ? { panelChannelId: payload.panelChannelId } : {}),
        ...(typeof payload.enabled === 'boolean' ? { enabled: payload.enabled } : {}),
    };
}

function validateDashboardVcGeneratorRuleDeleteRouteInput(input: unknown): DashboardVcGeneratorRuleDeleteRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', sourceChannelId: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        sourceChannelId: typeof payload.sourceChannelId === 'string' ? payload.sourceChannelId : '',
    };
}
