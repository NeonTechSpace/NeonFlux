import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardReactionRoleMessageDeleteResult,
    DashboardReactionRoleMessageUpdateResult,
    DashboardReactionRoleOptionDeleteResult,
    DashboardReactionRoleOptionUpdateResult,
    DashboardReactionRolesSettingsResult,
} from './dashboard-reaction-roles.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

type DashboardReactionRoleMessageUpdateRouteInput = {
    guildId: string;
    channelId: string;
    messageId: string;
    removeOnUnreact?: boolean;
    enabled?: boolean;
};

type DashboardReactionRoleOptionUpdateRouteInput = {
    guildId: string;
    messageId: string;
    emojiKey: string;
    roleId: string;
};

type DashboardReactionRoleOptionDeleteRouteInput = {
    guildId: string;
    messageId: string;
    emojiKey: string;
};

type DashboardReactionRoleMessageDeleteRouteInput = {
    guildId: string;
    messageId: string;
};

export const readDashboardReactionRolesSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardReactionRolesSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardReactionRolesSettings } = await import('./dashboard-reaction-roles.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardReactionRolesSettings(getRequest(), data.guildId);
    });

export const updateDashboardReactionRoleMessageRouteData = createServerFn({ method: 'POST' })
    .validator(validateReactionRoleMessageUpdateRouteInput)
    .handler(async ({ data }): Promise<DashboardReactionRoleMessageUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardReactionRoleMessage } = await import('./dashboard-reaction-roles.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardReactionRoleMessage(getRequest(), data);
    });

export const updateDashboardReactionRoleOptionRouteData = createServerFn({ method: 'POST' })
    .validator(validateReactionRoleOptionUpdateRouteInput)
    .handler(async ({ data }): Promise<DashboardReactionRoleOptionUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardReactionRoleOption } = await import('./dashboard-reaction-roles.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardReactionRoleOption(getRequest(), data);
    });

export const deleteDashboardReactionRoleOptionRouteData = createServerFn({ method: 'POST' })
    .validator(validateReactionRoleOptionDeleteRouteInput)
    .handler(async ({ data }): Promise<DashboardReactionRoleOptionDeleteResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { deleteDashboardReactionRoleOption } = await import('./dashboard-reaction-roles.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return deleteDashboardReactionRoleOption(getRequest(), data);
    });

export const deleteDashboardReactionRoleMessageRouteData = createServerFn({ method: 'POST' })
    .validator(validateReactionRoleMessageDeleteRouteInput)
    .handler(async ({ data }): Promise<DashboardReactionRoleMessageDeleteResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { deleteDashboardReactionRoleMessage } = await import('./dashboard-reaction-roles.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return deleteDashboardReactionRoleMessage(getRequest(), data);
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

function validateReactionRoleMessageUpdateRouteInput(input: unknown): DashboardReactionRoleMessageUpdateRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', channelId: '', messageId: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        channelId: typeof payload.channelId === 'string' ? payload.channelId : '',
        messageId: typeof payload.messageId === 'string' ? payload.messageId : '',
        ...(typeof payload.removeOnUnreact === 'boolean' ? { removeOnUnreact: payload.removeOnUnreact } : {}),
        ...(typeof payload.enabled === 'boolean' ? { enabled: payload.enabled } : {}),
    };
}

function validateReactionRoleOptionUpdateRouteInput(input: unknown): DashboardReactionRoleOptionUpdateRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', messageId: '', emojiKey: '', roleId: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        messageId: typeof payload.messageId === 'string' ? payload.messageId : '',
        emojiKey: typeof payload.emojiKey === 'string' ? payload.emojiKey : '',
        roleId: typeof payload.roleId === 'string' ? payload.roleId : '',
    };
}

function validateReactionRoleOptionDeleteRouteInput(input: unknown): DashboardReactionRoleOptionDeleteRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', messageId: '', emojiKey: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        messageId: typeof payload.messageId === 'string' ? payload.messageId : '',
        emojiKey: typeof payload.emojiKey === 'string' ? payload.emojiKey : '',
    };
}

function validateReactionRoleMessageDeleteRouteInput(input: unknown): DashboardReactionRoleMessageDeleteRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', messageId: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        messageId: typeof payload.messageId === 'string' ? payload.messageId : '',
    };
}
