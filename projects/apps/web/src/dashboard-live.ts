const dashboardLiveAreas = [
    'overview',
    'commands',
    'reaction_roles',
    'posting',
    'import_export',
    'structure',
    'audit',
] as const;

export type DashboardLiveArea = (typeof dashboardLiveAreas)[number];
