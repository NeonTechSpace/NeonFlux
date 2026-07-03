export const dashboardLiveAreas = [
    'overview',
    'commands',
    'access',
    'autorole',
    'moderation',
    'logging',
    'reaction_roles',
    'role_reconciliation',
    'verification',
    'xp',
    'vc_generator',
    'posting',
    'tickets',
    'suggestions',
    'profile_builder',
    'giveaways',
    'invites',
    'import_export',
    'structure',
    'audit',
] as const;

export type DashboardLiveArea = (typeof dashboardLiveAreas)[number];

export type DashboardLiveStateRecord = {
    area: DashboardLiveArea;
    guildId: string;
    updatedAt: string;
    version: number;
};

const dashboardLiveAreaSet = new Set<string>(dashboardLiveAreas);
const featureAreaMap = new Map<string, readonly DashboardLiveArea[]>([
    ['access', ['access']],
    ['autorole', ['autorole']],
    ['automod', ['moderation']],
    ['giveaways', ['giveaways']],
    ['import_export', ['import_export', 'structure']],
    ['logging', ['logging']],
    ['moderation', ['moderation']],
    ['posting', ['posting']],
    ['profile_builder', ['profile_builder']],
    ['reaction_roles', ['reaction_roles']],
    ['role_reconciliation', ['role_reconciliation']],
    ['settings', ['commands']],
    ['suggestions', ['suggestions']],
    ['tickets', ['tickets']],
    ['vc_generator', ['vc_generator']],
    ['verification', ['verification']],
    ['xp', ['xp']],
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
