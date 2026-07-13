const dashboardLiveAreas = [
    'overview',
    'commands',
    'posting',
    'import_export',
    'structure',
    'structure_execution',
    'audit',
] as const;

export type DashboardLiveArea = (typeof dashboardLiveAreas)[number];
