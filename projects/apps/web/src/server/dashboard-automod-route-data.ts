import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardAutomodRuleDeleteResult,
    DashboardAutomodRuleUpdateResult,
    DashboardAutomodSettingsResult,
} from './dashboard-automod.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

type DashboardAutomodRuleUpdateRouteInput = {
    guildId: string;
    ruleId?: string;
    name: string;
    triggerType: 'blocked_terms' | 'invite_links';
    actionType?: 'record' | 'delete_message' | 'timeout' | 'warn';
    enabled?: boolean;
    terms?: string[];
    timeoutDurationSeconds?: number;
    ignoredChannelIds?: string[];
    ignoredRoleIds?: string[];
    ignoredUserIds?: string[];
};

type DashboardAutomodRuleDeleteRouteInput = {
    guildId: string;
    ruleId: string;
};

export const readDashboardAutomodSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardAutomodSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardAutomodSettings } = await import('./dashboard-automod.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardAutomodSettings(getRequest(), data.guildId);
    });

export const updateDashboardAutomodRuleRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardAutomodRuleUpdateRouteInput)
    .handler(async ({ data }): Promise<DashboardAutomodRuleUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardAutomodRule } = await import('./dashboard-automod.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardAutomodRule(getRequest(), data);
    });

export const deleteDashboardAutomodRuleRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardAutomodRuleDeleteRouteInput)
    .handler(async ({ data }): Promise<DashboardAutomodRuleDeleteResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { deleteDashboardAutomodRule } = await import('./dashboard-automod.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return deleteDashboardAutomodRule(getRequest(), data);
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

function validateDashboardAutomodRuleUpdateRouteInput(input: unknown): DashboardAutomodRuleUpdateRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', name: '', triggerType: 'blocked_terms', terms: [] };
    }

    const payload = input as Record<string, unknown>;
    const triggerType = payload.triggerType;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        ...(typeof payload.ruleId === 'string' ? { ruleId: payload.ruleId } : {}),
        name: typeof payload.name === 'string' ? payload.name : '',
        triggerType: triggerType === 'invite_links' ? 'invite_links' : 'blocked_terms',
        actionType: normalizeActionType(payload.actionType),
        ...(typeof payload.enabled === 'boolean' ? { enabled: payload.enabled } : {}),
        terms: Array.isArray(payload.terms) ? payload.terms.filter(isString) : [],
        ...(typeof payload.timeoutDurationSeconds === 'number'
            ? { timeoutDurationSeconds: payload.timeoutDurationSeconds }
            : {}),
        ignoredChannelIds: Array.isArray(payload.ignoredChannelIds) ? payload.ignoredChannelIds.filter(isString) : [],
        ignoredRoleIds: Array.isArray(payload.ignoredRoleIds) ? payload.ignoredRoleIds.filter(isString) : [],
        ignoredUserIds: Array.isArray(payload.ignoredUserIds) ? payload.ignoredUserIds.filter(isString) : [],
    };
}

function validateDashboardAutomodRuleDeleteRouteInput(input: unknown): DashboardAutomodRuleDeleteRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', ruleId: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: typeof payload.guildId === 'string' ? payload.guildId : '',
        ruleId: typeof payload.ruleId === 'string' ? payload.ruleId : '',
    };
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

function normalizeActionType(value: unknown): DashboardAutomodRuleUpdateRouteInput['actionType'] {
    return value === 'delete_message' || value === 'timeout' || value === 'warn' ? value : 'record';
}
