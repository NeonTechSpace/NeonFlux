const dashboardLiveAreas = ['commands', 'posting', 'reaction_roles', 'blueprint', 'blueprint_run', 'audit'] as const;

export type DashboardLiveArea = (typeof dashboardLiveAreas)[number];
