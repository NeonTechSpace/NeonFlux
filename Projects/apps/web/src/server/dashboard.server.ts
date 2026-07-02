import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';

import { loadDashboardGuildAccess } from './dashboard-guild-access.server.js';
import type { DashboardGuildAccessError } from './dashboard-guild-access.server.js';
import { toDashboardViewModel } from './dashboard-view-model.server.js';
import type { DashboardViewModel } from './dashboard-view-model.server.js';

export type DashboardDataResult =
    | {
          type: 'dashboard';
          viewModel: DashboardViewModel;
      }
    | { type: 'auth-required' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

export async function loadDashboardData(request: Request): Promise<DashboardDataResult> {
    const guildAccessResult = await loadDashboardGuildAccess(request);

    if (guildAccessResult.isErr()) {
        return mapDashboardAccessError(guildAccessResult.error);
    }

    const config = loadWebConfig();

    return {
        type: 'dashboard',
        viewModel: toDashboardViewModel(guildAccessResult.value, {
            ...(config.fluxerBotInviteUrl ? { botInviteUrl: config.fluxerBotInviteUrl } : {}),
        }),
    };
}

function mapDashboardAccessError(error: DashboardGuildAccessError): DashboardDataResult {
    switch (error) {
        case 'missing-cookie':
        case 'invalid-cookie':
        case 'invalid-signature':
        case 'not-found':
        case 'missing-token-set':
        case 'token-expired':
        case 'missing-refresh-token':
        case 'token-refresh-failed':
        case 'invalid-token-payload':
        case 'decrypt-failed':
            return { type: 'auth-required' };

        case 'database-error':
            return { type: 'database-error' };

        case 'deployment-config-not-found':
            return { type: 'deployment-config-not-found' };

        case 'guild-lookup-failed':
            return { type: 'guild-lookup-failed' };
    }
}
