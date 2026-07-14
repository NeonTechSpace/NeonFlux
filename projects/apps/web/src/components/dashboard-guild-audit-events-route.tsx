import { DashboardAuditEventsPanel } from './dashboard-audit-events-panel.js';
import { useDashboardGuildData } from './dashboard-guild-context.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';

const auditLiveArea = ['audit'] as const;

export function DashboardGuildAuditEventsRoute() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: auditLiveArea,
    });

    return <DashboardAuditEventsPanel guildId={data.guild.id} />;
}
