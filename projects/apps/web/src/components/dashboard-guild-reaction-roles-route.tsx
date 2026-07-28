import { useDashboardGuildData } from './dashboard-guild-context.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';
import { DashboardReactionRolesPanel } from './dashboard-reaction-roles-panel.js';

const liveAreas = ['reaction_roles'] as const;

export function DashboardGuildReactionRolesRoute() {
    const data = useDashboardGuildData();
    useDashboardLiveInvalidation({ areas: liveAreas, guildId: data.guild.id });
    return <DashboardReactionRolesPanel guildId={data.guild.id} />;
}
