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
