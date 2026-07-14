import { getDashboardCategory, getDashboardNavigationJob } from '../dashboard-categories.js';
import { useDashboardGuildData } from './dashboard-guild-context.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';
import { DashboardServerOverviewPanel } from './dashboard-server-overview-panel.js';
import { DashboardFeaturePage } from './dashboard-ui.js';

const overviewLiveArea = ['overview'] as const;

export function DashboardGuildOverviewRoute() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: overviewLiveArea,
    });

    const category = getDashboardCategory('overview');
    const FeatureIcon = category.icon;

    return (
        <DashboardFeaturePage
            title='Server pulse'
            description='Growth and message activity across this server.'
            eyebrow={getDashboardNavigationJob('overview').label}
            icon={<FeatureIcon className='size-5' aria-hidden='true' />}
            titleId='dashboard-overview-heading'
            width='wide'>
            <DashboardServerOverviewPanel guildId={data.guild.id} />
        </DashboardFeaturePage>
    );
}
