export const dashboardLiveAreas = ['overview', 'commands', 'posting', 'blueprint', 'blueprint_run', 'audit'] as const;

export type DashboardLiveArea = (typeof dashboardLiveAreas)[number];
export const blueprintRunLiveAreas = ['blueprint_run'] as const satisfies readonly DashboardLiveArea[];

export type DashboardLiveStateRecord = {
    area: DashboardLiveArea;
    guildId: string;
    updatedAt: string;
    version: number;
};

const dashboardLiveAreaSet = new Set<string>(dashboardLiveAreas);
const featureAreaMap = new Map<string, readonly DashboardLiveArea[]>([
    ['blueprint', ['blueprint']],
    ['posting', ['posting']],
    ['settings', ['commands']],
]);

export function normalizeDashboardLiveGuildId(guildId: string): string {
    return guildId.trim();
}

export function normalizeDashboardLiveAreas(areas: readonly string[]): DashboardLiveArea[] {
    const normalizedAreas = new Set<DashboardLiveArea>();

    for (const area of areas) {
        const trimmedArea = area.trim();

        if (isDashboardLiveArea(trimmedArea)) {
            normalizedAreas.add(trimmedArea);
        }
    }

    return [...normalizedAreas];
}

export function dashboardLiveAreasForBotActionFeature(feature: string): DashboardLiveArea[] {
    const featureAreas = featureAreaMap.get(feature.trim());
    return normalizeDashboardLiveAreas([...(featureAreas ?? []), 'audit']);
}

function isDashboardLiveArea(area: string): area is DashboardLiveArea {
    return dashboardLiveAreaSet.has(area);
}
