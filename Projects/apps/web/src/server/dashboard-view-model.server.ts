import '@tanstack/react-start/server-only';

import type { DashboardGuildAccess } from './dashboard-guild-access.server.js';

export type DashboardViewModel =
    | {
          type: 'guild-list';
          mode: 'single' | 'multi';
          guilds: DashboardViewModelGuild[];
          botInviteUrl?: string;
      }
    | {
          type: 'single-unauthorized';
          configuredGuildId: string;
          configuredGuildName: string;
      }
    | { type: 'multi-empty'; botInviteUrl?: string };

export type DashboardViewModelGuild = {
    id: string;
    name: string;
    iconUrl?: string;
};

export function toDashboardViewModel(
    guildAccess: DashboardGuildAccess,
    options: { botInviteUrl?: string } = {}
): DashboardViewModel {
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
                ...(options.botInviteUrl ? { botInviteUrl: options.botInviteUrl } : {}),
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
                ...(options.botInviteUrl ? { botInviteUrl: options.botInviteUrl } : {}),
            };
    }
}
