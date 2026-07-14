type DashboardBlueprintSurface = 'current' | 'backups' | 'compare' | 'deploy' | 'runs';

export type DashboardBlueprintNavigationTo =
    | '/dashboard/$guildId/blueprint/current'
    | '/dashboard/$guildId/blueprint/backups'
    | '/dashboard/$guildId/blueprint/compare'
    | '/dashboard/$guildId/blueprint/deploy'
    | '/dashboard/$guildId/blueprint/runs';

export const dashboardBlueprintIdentity = {
    title: 'Server Blueprint',
    description: 'Capture versions, understand differences, and apply reviewed changes.',
    eyebrow: 'Blueprint & recovery',
} as const;

type DashboardBlueprintNavigationItem = {
    id: DashboardBlueprintSurface;
    label: string;
    title: string;
    description: string;
    to: DashboardBlueprintNavigationTo;
};

export const dashboardBlueprintNavigationItems = [
    {
        id: 'current',
        label: 'Overview',
        title: 'Blueprint overview',
        description: 'Backup health, recent layout activity, and a clear path to inspect the live server.',
        to: '/dashboard/$guildId/blueprint/current',
    },
    {
        id: 'backups',
        label: 'Backups',
        title: 'Protected versions',
        description: 'Backups provide comparison baselines and deliberate recovery sources.',
        to: '/dashboard/$guildId/blueprint/backups',
    },
    {
        id: 'compare',
        label: 'Compare',
        title: 'Compare layouts',
        description: 'Review domain changes before inspecting normalized JSON details.',
        to: '/dashboard/$guildId/blueprint/compare',
    },
    {
        id: 'deploy',
        label: 'Deploy',
        title: 'Deploy a blueprint',
        description: 'Prepare, review, safety-check, and deliberately apply one blueprint.',
        to: '/dashboard/$guildId/blueprint/deploy',
    },
    {
        id: 'runs',
        label: 'Runs',
        title: 'Deployment runs',
        description: 'Track active, recoverable, and completed deployment work.',
        to: '/dashboard/$guildId/blueprint/runs',
    },
] as const satisfies readonly DashboardBlueprintNavigationItem[];

export function getDefaultDashboardBlueprintTo(): DashboardBlueprintNavigationTo {
    return dashboardBlueprintNavigationItems[0].to;
}

export function getDashboardBlueprintSurfaceTo(surface: DashboardBlueprintSurface): DashboardBlueprintNavigationTo {
    return (
        dashboardBlueprintNavigationItems.find((item) => item.id === surface)?.to ?? getDefaultDashboardBlueprintTo()
    );
}

export function readDashboardBlueprintSurfaceFromPathname(pathname: string): DashboardBlueprintSurface | undefined {
    return dashboardBlueprintNavigationItems.find((item) => pathname.endsWith(`/blueprint/${item.id}`))?.id;
}
