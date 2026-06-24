import '@tanstack/react-start/server-only';

import type { DashboardGuildAccess } from './dashboard-guild-access.server.js';

export type DashboardViewModel =
    | {
          type: 'guild-list';
          mode: 'single' | 'multi';
          guilds: DashboardViewModelGuild[];
      }
    | {
          type: 'single-unauthorized';
          configuredGuildId: string;
          configuredGuildName: string;
      }
    | { type: 'multi-empty' };

export type DashboardViewModelGuild = {
    id: string;
    name: string;
    iconUrl?: string;
};

export function toDashboardViewModel(guildAccess: DashboardGuildAccess): DashboardViewModel {
    switch (guildAccess.type) {
        case 'authorized':
            return {
                type: 'guild-list',
                mode: guildAccess.mode.instanceMode,
                guilds: guildAccess.guilds.map((guild) => ({
                    id: guild.id,
                    name: guild.name ?? guild.id,
                    ...(guild.iconUrl ? { iconUrl: guild.iconUrl } : {}),
                })),
            };

        case 'unauthorized':
            return {
                type: 'single-unauthorized',
                configuredGuildId: guildAccess.configuredGuildId,
                configuredGuildName: guildAccess.configuredGuildName ?? guildAccess.configuredGuildId,
            };

        case 'no-manageable-guilds':
            return {
                type: 'multi-empty',
            };
    }
}
