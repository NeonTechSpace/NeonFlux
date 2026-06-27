import { createServerFn } from '@tanstack/react-start';

import type { DashboardXpSettingsResult, DashboardXpSettingsUpdateResult } from './dashboard-xp.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

type DashboardXpSettingsUpdateRouteInput = {
    guildId: string;
    enabled?: boolean;
    messageXpMin?: number;
    messageXpMax?: number;
    cooldownSeconds?: number;
    voiceXpPerMinute?: number;
    voiceMinimumMinutes?: number;
};

export const readDashboardXpSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardXpSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardXpSettings } = await import('./dashboard-xp.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardXpSettings(getRequest(), data.guildId);
    });

export const updateDashboardXpSettingsRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardXpSettingsUpdateRouteInput)
    .handler(async ({ data }): Promise<DashboardXpSettingsUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardXpSettings } = await import('./dashboard-xp.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardXpSettings(getRequest(), data);
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

function validateDashboardXpSettingsUpdateRouteInput(input: unknown): DashboardXpSettingsUpdateRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        ...(typeof payload.enabled === 'boolean' ? { enabled: payload.enabled } : {}),
        ...numberField(payload, 'messageXpMin'),
        ...numberField(payload, 'messageXpMax'),
        ...numberField(payload, 'cooldownSeconds'),
        ...numberField(payload, 'voiceXpPerMinute'),
        ...numberField(payload, 'voiceMinimumMinutes'),
    };
}

function numberField(
    payload: Record<string, unknown>,
    field: 'messageXpMin' | 'messageXpMax' | 'cooldownSeconds' | 'voiceXpPerMinute' | 'voiceMinimumMinutes'
): Partial<DashboardXpSettingsUpdateRouteInput> {
    const value = payload[field];

    return typeof value === 'number' ? { [field]: value } : {};
}
