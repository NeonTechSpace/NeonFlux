import { getDashboardCategory, getDashboardNavigationJob } from '../dashboard-categories.js';
import { useDashboardGuildData } from './dashboard-guild-context.js';
import { DashboardServerOverviewPanel } from './dashboard-server-overview-panel.js';
import { DashboardFeaturePage } from './dashboard-ui.js';

export function DashboardGuildOverviewRoute() {
    const data = useDashboardGuildData();

    const category = getDashboardCategory('overview');
    const FeatureIcon = category.icon;

    return (
        <DashboardFeaturePage
            title='Server pulse'
            description='Observed member movement and member-authored message activity across this server.'
            eyebrow={getDashboardNavigationJob('overview').label}
            icon={<FeatureIcon className='size-5' aria-hidden='true' />}
            titleId='dashboard-overview-heading'
            width='wide'>
            <DashboardServerOverviewPanel guildId={data.guild.id} />
        </DashboardFeaturePage>
    );
}
