import type { AppMode } from '@neonflux/config';

export type GuildEventScope = {
    guildId: string | null | undefined;
    installedGuildIds?: ReadonlySet<string> | readonly string[];
};

export type DashboardGuild = {
    id: string;
    name?: string;
    ownerId?: string;
    canManage: boolean;
    botInstalled?: boolean;
};

export function shouldHandleGuildEvent(mode: AppMode, event: GuildEventScope): boolean {
    if (!event.guildId) {
        return false;
    }

    switch (mode.instanceMode) {
        case 'single':
            return event.guildId === mode.singleGuildId;

        case 'multi':
            return isInstalledGuild(event.guildId, event.installedGuildIds);
    }
}

export function selectDashboardGuilds(mode: AppMode, guilds: readonly DashboardGuild[]): DashboardGuild[] {
    switch (mode.instanceMode) {
        case 'single':
            return guilds.filter((guild) => guild.id === mode.singleGuildId && guild.canManage);

        case 'multi':
            return guilds.filter((guild) => guild.canManage && guild.botInstalled === true);
    }
}

function isInstalledGuild(
    guildId: string,
    installedGuildIds: ReadonlySet<string> | readonly string[] | undefined
): boolean {
    if (!installedGuildIds) {
        return true;
    }

    if ('has' in installedGuildIds) {
        return installedGuildIds.has(guildId);
    }

    return installedGuildIds.includes(guildId);
}
