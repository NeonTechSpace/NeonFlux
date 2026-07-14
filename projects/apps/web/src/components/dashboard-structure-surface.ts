export type DashboardStructureSurface = 'current' | 'backups' | 'compare' | 'deploy' | 'runs';

export const dashboardStructureSurfaceIdentity: Record<
    DashboardStructureSurface,
    { heading: string; description: string }
> = {
    current: {
        heading: 'Blueprint overview',
        description: 'Backup health and observed activity. Inspecting the live layout performs a fresh server read.',
    },
    backups: {
        heading: 'Protected versions',
        description: 'Create, schedule, retain, and reuse protected server layouts.',
    },
    compare: {
        heading: 'Compare layouts',
        description: 'Domain changes first. Raw normalized JSON remains an advanced inspection mode.',
    },
    deploy: {
        heading: 'Deploy a blueprint',
        description: 'Choose the intended result, review every change, then apply with a fresh safety check.',
    },
    runs: {
        heading: 'Deployment runs',
        description: 'Active work stays at the top; completed runs follow.',
    },
};
