import { DashboardCommandPrefixRouteContent } from './dashboard-command-prefix-route-content.js';
import { useDashboardGuildData } from './dashboard-guild-context.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';

const commandLiveArea = ['commands'] as const;

export function DashboardGuildCommandPrefixRoute() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: commandLiveArea,
    });

    return <DashboardCommandPrefixRouteContent guildId={data.guild.id} />;
}
