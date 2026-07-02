import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';

import { loadDashboardGuildAccess } from './dashboard-guild-access.server.js';
import type { DashboardGuildAccessError } from './dashboard-guild-access.server.js';

export type DashboardGuildShellGuild = {
    id: string;
    name: string;
    iconUrl?: string;
};

export type DashboardGuildPageDataResult =
    | {
          type: 'guild';
          mode: 'single' | 'multi';
          guild: DashboardGuildShellGuild;
          manageableGuilds?: DashboardGuildShellGuild[];
          botInviteUrl?: string;
      }
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | {
          type: 'single-unauthorized';
          configuredGuildId: string;
          configuredGuildName: string;
      }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

export async function loadDashboardGuildPageData(
    request: Request,
    guildId: string
): Promise<DashboardGuildPageDataResult> {
    const normalizedGuildId = guildId.trim();

    if (!normalizedGuildId) {
        return { type: 'not-found' };
    }

    const guildAccessResult = await loadDashboardGuildAccess(request);

    if (guildAccessResult.isErr()) {
        return mapDashboardGuildPageAccessError(guildAccessResult.error);
    }

    const guildAccess = guildAccessResult.value;

    switch (guildAccess.type) {
        case 'authorized': {
            const guild = guildAccess.guilds.find((candidate) => candidate.id === normalizedGuildId);

            if (!guild) {
                return { type: 'not-found' };
            }

            const config = loadWebConfig();

            return {
                type: 'guild',
                mode: guildAccess.mode.instanceMode,
                guild: toDashboardGuildShellGuild(guild),
                manageableGuilds: guildAccess.guilds.map(toDashboardGuildShellGuild),
                ...(config.fluxerBotInviteUrl ? { botInviteUrl: config.fluxerBotInviteUrl } : {}),
            };
        }

        case 'unauthorized':
            if (guildAccess.configuredGuildId !== normalizedGuildId) {
                return { type: 'not-found' };
            }

            return {
                type: 'single-unauthorized',
                configuredGuildId: guildAccess.configuredGuildId,
                configuredGuildName: guildAccess.configuredGuildName ?? guildAccess.configuredGuildId,
            };

        case 'no-manageable-guilds':
            return { type: 'not-found' };
    }
}

function toDashboardGuildShellGuild(guild: { id: string; name?: string; iconUrl?: string }): DashboardGuildShellGuild {
    return {
        id: guild.id,
        name: guild.name ?? guild.id,
        ...(guild.iconUrl ? { iconUrl: guild.iconUrl } : {}),
    };
}

function mapDashboardGuildPageAccessError(error: DashboardGuildAccessError): DashboardGuildPageDataResult {
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

        case 'deployment-config-not-found':
            return { type: 'deployment-config-not-found' };

        case 'database-error':
            return { type: 'database-error' };

        case 'guild-lookup-failed':
            return { type: 'guild-lookup-failed' };
    }
}
