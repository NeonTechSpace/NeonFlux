export type DashboardCategoryId =
    | 'overview'
    | 'general'
    | 'messaging'
    | 'access'
    | 'moderation'
    | 'logging'
    | 'community'
    | 'structure'
    | 'audit';

export type DashboardCategoryDefinition = {
    id: DashboardCategoryId;
    label: string;
    path: string;
    to: DashboardCategoryTo;
    description: string;
    status: 'active' | 'planned';
};

export type DashboardCategoryTo =
    | '/dashboard/$guildId'
    | '/dashboard/$guildId/general'
    | '/dashboard/$guildId/messaging'
    | '/dashboard/$guildId/access'
    | '/dashboard/$guildId/moderation'
    | '/dashboard/$guildId/logging'
    | '/dashboard/$guildId/community'
    | '/dashboard/$guildId/structure'
    | '/dashboard/$guildId/audit';

export const dashboardCategories = [
    {
        id: 'overview',
        label: 'Overview',
        path: '',
        to: '/dashboard/$guildId',
        description: 'Recent dashboard and bot-app activity.',
        status: 'active',
    },
    {
        id: 'general',
        label: 'General',
        path: 'general',
        to: '/dashboard/$guildId/general',
        description: 'Core bot settings such as command prefix and presence.',
        status: 'active',
    },
    {
        id: 'messaging',
        label: 'Messaging',
        path: 'messaging',
        to: '/dashboard/$guildId/messaging',
        description: 'Dashboard posting, embeds, and message templates.',
        status: 'active',
    },
    {
        id: 'access',
        label: 'Roles & Access',
        path: 'access',
        to: '/dashboard/$guildId/access',
        description: 'Role automation, command grants, and access controls.',
        status: 'planned',
    },
    {
        id: 'moderation',
        label: 'Moderation',
        path: 'moderation',
        to: '/dashboard/$guildId/moderation',
        description: 'Moderation settings and protected-role policy.',
        status: 'planned',
    },
    {
        id: 'logging',
        label: 'Logging',
        path: 'logging',
        to: '/dashboard/$guildId/logging',
        description: 'Discord server-event logging destinations and filters.',
        status: 'planned',
    },
    {
        id: 'community',
        label: 'Community',
        path: 'community',
        to: '/dashboard/$guildId/community',
        description: 'Tickets, suggestions, XP, and voice-channel workflows.',
        status: 'planned',
    },
    {
        id: 'structure',
        label: 'Structure',
        path: 'structure',
        to: '/dashboard/$guildId/structure',
        description: 'Import, export, and server structure tools.',
        status: 'planned',
    },
    {
        id: 'audit',
        label: 'Audit Events',
        path: 'audit',
        to: '/dashboard/$guildId/audit',
        description: 'Dashboard and bot-app change history.',
        status: 'active',
    },
] as const satisfies readonly DashboardCategoryDefinition[];

export function getDashboardCategory(id: DashboardCategoryId): DashboardCategoryDefinition {
    const category = dashboardCategories.find((candidate) => candidate.id === id);

    if (!category) {
        throw new Error(`Unknown dashboard category: ${id}`);
    }

    return category;
}

export function getDashboardCategoryIdFromPathname(guildId: string, pathname: string): DashboardCategoryId {
    const guildPathPrefix = `/dashboard/${guildId}`;

    if (pathname === guildPathPrefix || pathname === `${guildPathPrefix}/`) {
        return 'overview';
    }

    const categoryPath =
        pathname
            .slice(guildPathPrefix.length + 1)
            .split('/')
            .at(0) ?? '';
    const category = dashboardCategories.find((candidate) => candidate.path === categoryPath);

    return category?.id ?? 'overview';
}
