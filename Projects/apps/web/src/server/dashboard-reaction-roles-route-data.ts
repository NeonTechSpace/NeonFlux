import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardReactionRoleMessageDeleteResult,
    DashboardReactionRoleMessageSaveResult,
    DashboardReactionRolePublishResult,
    DashboardReactionRolesSettingsResult,
} from './dashboard-reaction-roles.server.js';
import type {
    DashboardReactionRoleEmbedPayload,
    DashboardReactionRoleJsonValue,
} from './dashboard-reaction-roles-payload.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

type DashboardReactionRoleMessageSaveRouteInput = {
    guildId: string;
    messageId: string;
    content?: string;
    embeds?: DashboardReactionRoleEmbedPayload[];
    mode: 'normal' | 'exclusive';
    generateOverview: boolean;
    options: Array<{
        emojiKey: string;
        emojiLabel?: string;
        roleId: string;
        position: number;
    }>;
};

type DashboardReactionRolePublishRouteInput = {
    guildId: string;
    channelId: string;
    content?: string;
    embeds?: DashboardReactionRoleEmbedPayload[];
    mode: 'normal' | 'exclusive';
    generateOverview: boolean;
    options: Array<{
        emojiKey: string;
        emojiLabel?: string;
        roleId: string;
        position: number;
    }>;
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

export const publishDashboardReactionRoleMessageRouteData = createServerFn({ method: 'POST' })
    .validator(validateReactionRolePublishRouteInput)
    .handler(async ({ data }): Promise<DashboardReactionRolePublishResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { publishDashboardReactionRoleMessage } = await import('./dashboard-reaction-roles.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return publishDashboardReactionRoleMessage(getRequest(), data);
    });

export const saveDashboardReactionRoleMessageRouteData = createServerFn({ method: 'POST' })
    .validator(validateReactionRoleMessageSaveRouteInput)
    .handler(async ({ data }): Promise<DashboardReactionRoleMessageSaveResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { saveDashboardReactionRoleMessage } = await import('./dashboard-reaction-roles.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return saveDashboardReactionRoleMessage(getRequest(), data);
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

function validateReactionRolePublishRouteInput(input: unknown): DashboardReactionRolePublishRouteInput {
    if (!input || typeof input !== 'object') {
        return {
            guildId: '',
            channelId: '',
            mode: 'normal',
            generateOverview: false,
            options: [],
        };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        channelId: typeof payload.channelId === 'string' ? payload.channelId : '',
        ...(typeof payload.content === 'string' ? { content: payload.content } : {}),
        embeds: Array.isArray(payload.embeds) ? toSerializableEmbedArray(payload.embeds) : [],
        mode: payload.mode === 'exclusive' ? 'exclusive' : 'normal',
        generateOverview: payload.generateOverview === true,
        options: Array.isArray(payload.options) ? payload.options.map(validateReactionRolePublishOptionRouteInput) : [],
    };
}

function validateReactionRoleMessageSaveRouteInput(input: unknown): DashboardReactionRoleMessageSaveRouteInput {
    if (!input || typeof input !== 'object') {
        return {
            guildId: '',
            messageId: '',
            mode: 'normal',
            generateOverview: false,
            options: [],
        };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        messageId: typeof payload.messageId === 'string' ? payload.messageId : '',
        ...(typeof payload.content === 'string' ? { content: payload.content } : {}),
        embeds: Array.isArray(payload.embeds) ? toSerializableEmbedArray(payload.embeds) : [],
        mode: payload.mode === 'exclusive' ? 'exclusive' : 'normal',
        generateOverview: payload.generateOverview === true,
        options: Array.isArray(payload.options) ? payload.options.map(validateReactionRolePublishOptionRouteInput) : [],
    };
}

function validateReactionRolePublishOptionRouteInput(input: unknown) {
    const option = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};

    return {
        emojiKey: typeof option.emojiKey === 'string' ? option.emojiKey : '',
        ...(typeof option.emojiLabel === 'string' ? { emojiLabel: option.emojiLabel } : {}),
        roleId: typeof option.roleId === 'string' ? option.roleId : '',
        position: typeof option.position === 'number' && Number.isInteger(option.position) ? option.position : 0,
    };
}

function toSerializableEmbedArray(values: unknown[]): DashboardReactionRoleEmbedPayload[] {
    return values.map(toJsonValue).filter(isSerializableRecord);
}

function isSerializableRecord(
    value: DashboardReactionRoleJsonValue | undefined
): value is DashboardReactionRoleEmbedPayload {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): DashboardReactionRoleJsonValue | undefined {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }

    if (Array.isArray(value)) {
        return value.map(toJsonValue).filter((item) => item !== undefined);
    }

    if (typeof value === 'object') {
        const output: { [key: string]: DashboardReactionRoleJsonValue } = {};

        for (const [key, child] of Object.entries(value)) {
            const jsonValue = toJsonValue(child);

            if (jsonValue !== undefined) {
                output[key] = jsonValue;
            }
        }

        return output;
    }

    return undefined;
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
