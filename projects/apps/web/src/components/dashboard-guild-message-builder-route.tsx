import { useDashboardGuildData } from './dashboard-guild-context.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';
import { DashboardPostingPanel } from './dashboard-posting-panel.js';

const messagingLiveArea = ['posting'] as const;

export function DashboardGuildMessageBuilderRoute() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: messagingLiveArea,
    });

    return <DashboardPostingPanel guildId={data.guild.id} />;
}
