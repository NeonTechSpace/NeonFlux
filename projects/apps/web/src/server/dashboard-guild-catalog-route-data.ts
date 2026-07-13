import { createServerFn } from '@tanstack/react-start';

import type { DashboardGuildShellGuild } from './dashboard-guild-page.server.js';
import type { DashboardDataResult } from './dashboard.server.js';

export type DashboardGuildCatalog = {
    botInviteUrl?: string;
    guilds: DashboardGuildShellGuild[];
    mode: 'single' | 'multi';
};

export type DashboardGuildCatalogReadResult =
    | { type: 'catalog'; catalog: DashboardGuildCatalog }
    | { type: 'auth-required' }
    | { type: 'unavailable' };

export function toDashboardGuildCatalogReadResult(data: DashboardDataResult): DashboardGuildCatalogReadResult {
    if (data.type === 'auth-required') {
        return { type: 'auth-required' };
    }

    if (data.type !== 'dashboard') {
        return { type: 'unavailable' };
    }

    switch (data.viewModel.type) {
        case 'guild-list':
            return {
                type: 'catalog',
                catalog: {
                    guilds: data.viewModel.guilds,
                    mode: data.viewModel.mode,
                    ...(data.viewModel.botInviteUrl ? { botInviteUrl: data.viewModel.botInviteUrl } : {}),
                },
            };

        case 'multi-empty':
            return {
                type: 'catalog',
                catalog: {
                    guilds: [],
                    mode: 'multi',
                    ...(data.viewModel.botInviteUrl ? { botInviteUrl: data.viewModel.botInviteUrl } : {}),
                },
            };

        case 'single-unauthorized':
            return {
                type: 'catalog',
                catalog: {
                    guilds: [],
                    mode: 'single',
                },
            };
    }
}

export const readDashboardGuildCatalogRouteData = createServerFn({ method: 'GET' }).handler(
    async (): Promise<DashboardGuildCatalogReadResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { loadDashboardData } = await import('./dashboard.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return toDashboardGuildCatalogReadResult(await loadDashboardData(getRequest()));
    }
);
