import { createServerFn } from '@tanstack/react-start';

import type {
    DashboardGiveawayActionInput,
    DashboardGiveawayMutationResult,
    DashboardGiveawayPublishInput,
    DashboardGiveawaysSettingsResult,
} from './dashboard-giveaways.server.js';

type DashboardGuildRouteInput = {
    guildId: string;
};

export const readDashboardGiveawaysSettingsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardGiveawaysSettingsResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardGiveawaysSettings } = await import('./dashboard-giveaways.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return loadDashboardGiveawaysSettings(getRequest(), data.guildId);
    });

export const publishDashboardGiveawayRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardGiveawayPublishInput)
    .handler(async ({ data }): Promise<DashboardGiveawayMutationResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { publishDashboardGiveaway } = await import('./dashboard-giveaways.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return publishDashboardGiveaway(getRequest(), data);
    });

export const closeDashboardGiveawayRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardGiveawayActionInput)
    .handler(async ({ data }): Promise<DashboardGiveawayMutationResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { closeDashboardGiveaway } = await import('./dashboard-giveaways.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return closeDashboardGiveaway(getRequest(), data);
    });

export const rerollDashboardGiveawayRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardGiveawayActionInput)
    .handler(async ({ data }): Promise<DashboardGiveawayMutationResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { rerollDashboardGiveaway } = await import('./dashboard-giveaways.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return rerollDashboardGiveaway(getRequest(), data);
    });

export const cancelDashboardGiveawayRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardGiveawayActionInput)
    .handler(async ({ data }): Promise<DashboardGiveawayMutationResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { cancelDashboardGiveaway } = await import('./dashboard-giveaways.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return cancelDashboardGiveaway(getRequest(), data);
    });

function validateDashboardGuildRouteInput(input: unknown): DashboardGuildRouteInput {
    if (!input || typeof input !== 'object') return { guildId: '' };

    return {
        guildId: readString((input as Record<string, unknown>).guildId),
    };
}

function validateDashboardGiveawayPublishInput(input: unknown): DashboardGiveawayPublishInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', channelId: '', title: '', prize: '' };
    }

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        channelId: readString(payload.channelId),
        title: readString(payload.title),
        prize: readString(payload.prize),
        description: readOptionalString(payload.description),
        entryEmoji: readOptionalString(payload.entryEmoji),
        winnerCount: typeof payload.winnerCount === 'number' ? payload.winnerCount : undefined,
        endsAt: readOptionalString(payload.endsAt),
    };
}

function validateDashboardGiveawayActionInput(input: unknown): DashboardGiveawayActionInput {
    if (!input || typeof input !== 'object') return { guildId: '', giveawayId: '' };

    const payload = input as Record<string, unknown>;

    return {
        guildId: readString(payload.guildId),
        giveawayId: readString(payload.giveawayId),
    };
}

function readString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}
