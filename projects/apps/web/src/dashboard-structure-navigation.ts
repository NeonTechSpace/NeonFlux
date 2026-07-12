export type DashboardStructureSurface = 'current' | 'backups' | 'compare' | 'deploy' | 'runs';

export type DashboardStructureNavigationTo =
    | '/dashboard/$guildId/structure/current'
    | '/dashboard/$guildId/structure/backups'
    | '/dashboard/$guildId/structure/compare'
    | '/dashboard/$guildId/structure/deploy'
    | '/dashboard/$guildId/structure/runs';

export const dashboardStructureIdentity = {
    title: 'Server Blueprint',
    description: 'Capture versions, understand differences, and apply reviewed changes.',
    eyebrow: 'Structure & recovery',
} as const;

type DashboardStructureNavigationItem = {
    id: DashboardStructureSurface;
    label: string;
    title: string;
    description: string;
    to: DashboardStructureNavigationTo;
};

export const dashboardStructureNavigationItems = [
    {
        id: 'current',
        label: 'Current',
        title: 'Current layout',
        description: 'The relationship between the latest protected version and what is live now.',
        to: '/dashboard/$guildId/structure/current',
    },
    {
        id: 'backups',
        label: 'Backups',
        title: 'Protected versions',
        description: 'Backups provide comparison baselines and deliberate recovery sources.',
        to: '/dashboard/$guildId/structure/backups',
    },
    {
        id: 'compare',
        label: 'Compare',
        title: 'Compare layouts',
        description: 'Review domain changes before inspecting normalized JSON details.',
        to: '/dashboard/$guildId/structure/compare',
    },
    {
        id: 'deploy',
        label: 'Deploy',
        title: 'Deploy a blueprint',
        description: 'Prepare, review, safety-check, and deliberately apply one blueprint.',
        to: '/dashboard/$guildId/structure/deploy',
    },
    {
        id: 'runs',
        label: 'Runs',
        title: 'Deployment runs',
        description: 'Track active, recoverable, and completed deployment work.',
        to: '/dashboard/$guildId/structure/runs',
    },
] as const satisfies readonly DashboardStructureNavigationItem[];

export function getDefaultDashboardStructureTo(): DashboardStructureNavigationTo {
    return dashboardStructureNavigationItems[0].to;
}
