import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardVerificationFlowDeleteResult,
    DashboardVerificationFlowUpdateResult,
    DashboardVerificationSettingsResult,
} from './dashboard-verification.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

type DashboardVerificationFlowUpdateRouteInput = {
    guildId: string;
    channelId: string;
    messageId: string;
    emojiKey: string;
    verifiedRoleId: string;
    enabled?: boolean;
};

type DashboardVerificationFlowDeleteRouteInput = {
    guildId: string;
    messageId: string;
};

export const readDashboardVerificationSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardVerificationSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardVerificationSettings } = await import('./dashboard-verification.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardVerificationSettings(getRequest(), data.guildId);
    });

export const updateDashboardVerificationFlowRouteData = createServerFn({ method: 'POST' })
    .validator(validateVerificationFlowUpdateRouteInput)
    .handler(async ({ data }): Promise<DashboardVerificationFlowUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardVerificationFlow } = await import('./dashboard-verification.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardVerificationFlow(getRequest(), data);
    });

export const deleteDashboardVerificationFlowRouteData = createServerFn({ method: 'POST' })
    .validator(validateVerificationFlowDeleteRouteInput)
    .handler(async ({ data }): Promise<DashboardVerificationFlowDeleteResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { deleteDashboardVerificationFlow } = await import('./dashboard-verification.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return deleteDashboardVerificationFlow(getRequest(), data);
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

function validateVerificationFlowUpdateRouteInput(input: unknown): DashboardVerificationFlowUpdateRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', channelId: '', messageId: '', emojiKey: '', verifiedRoleId: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        channelId: typeof payload.channelId === 'string' ? payload.channelId : '',
        messageId: typeof payload.messageId === 'string' ? payload.messageId : '',
        emojiKey: typeof payload.emojiKey === 'string' ? payload.emojiKey : '',
        verifiedRoleId: typeof payload.verifiedRoleId === 'string' ? payload.verifiedRoleId : '',
        ...(typeof payload.enabled === 'boolean' ? { enabled: payload.enabled } : {}),
    };
}

function validateVerificationFlowDeleteRouteInput(input: unknown): DashboardVerificationFlowDeleteRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', messageId: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        messageId: typeof payload.messageId === 'string' ? payload.messageId : '',
    };
}
