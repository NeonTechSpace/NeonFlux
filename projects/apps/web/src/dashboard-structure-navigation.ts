type DashboardStructureSurface = 'current' | 'backups' | 'compare' | 'deploy' | 'runs';

export type DashboardStructureNavigationTo =
    | '/dashboard/$guildId/structure/current'
    | '/dashboard/$guildId/structure/backups'
    | '/dashboard/$guildId/structure/compare'
    | '/dashboard/$guildId/structure/deploy'
    | '/dashboard/$guildId/structure/runs';

type DashboardStructureNavigationItem = {
    id: DashboardStructureSurface;
    label: string;
    to: DashboardStructureNavigationTo;
};

const dashboardStructureNavigationItems = [
    {
        id: 'current',
        label: 'Current',
        to: '/dashboard/$guildId/structure/current',
    },
    {
        id: 'backups',
        label: 'Backups',
        to: '/dashboard/$guildId/structure/backups',
    },
    {
        id: 'compare',
        label: 'Compare',
        to: '/dashboard/$guildId/structure/compare',
    },
    {
        id: 'deploy',
        label: 'Deploy',
        to: '/dashboard/$guildId/structure/deploy',
    },
    {
        id: 'runs',
        label: 'Runs',
        to: '/dashboard/$guildId/structure/runs',
    },
] as const satisfies readonly DashboardStructureNavigationItem[];

export function getDefaultDashboardStructureTo(): DashboardStructureNavigationTo {
    return dashboardStructureNavigationItems[0].to;
}
