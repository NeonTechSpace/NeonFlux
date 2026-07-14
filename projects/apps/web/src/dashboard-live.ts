const dashboardLiveAreas = ['overview', 'commands', 'posting', 'blueprint', 'blueprint_run', 'audit'] as const;

export type DashboardLiveArea = (typeof dashboardLiveAreas)[number];
