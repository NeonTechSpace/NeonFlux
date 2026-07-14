import {
    BarChart3,
    BellDot,
    ChartNoAxesCombined,
    GitBranch,
    MessageSquarePlus,
    MessageSquareText,
    ScrollText,
    Settings2,
    Terminal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type DashboardCategoryId = 'overview' | 'messaging' | 'general' | 'events' | 'structure';

export type DashboardNavigationJobId = 'overview' | 'create-deliver' | 'insights-activity' | 'blueprint' | 'settings';

type DashboardCategoryTo =
    | '/dashboard/$guildId'
    | '/dashboard/$guildId/messaging'
    | '/dashboard/$guildId/general'
    | '/dashboard/$guildId/events'
    | '/dashboard/$guildId/structure';

export type DashboardSubNavigationTo =
    | '/dashboard/$guildId/messaging/message-builder'
    | '/dashboard/$guildId/general/command-prefix'
    | '/dashboard/$guildId/events/audit-events';

export type DashboardCategoryDefinition = {
    id: DashboardCategoryId;
    label: string;
    path: string;
    to: DashboardCategoryTo;
    description: string;
    icon: LucideIcon;
};

export type DashboardSubNavigationItem = {
    id: string;
    categoryId: DashboardCategoryId;
    navigationJobId: DashboardNavigationJobId;
    label: string;
    description: string;
    to: DashboardSubNavigationTo;
    icon: LucideIcon;
    pageWidth: 'focused' | 'standard' | 'wide' | 'full';
};

export type DashboardNavigationJobDefinition = {
    id: DashboardNavigationJobId;
    label: string;
    description: string;
    icon: LucideIcon;
    routeCategoryIds: readonly DashboardCategoryId[];
};

type DashboardSubNavigationSetting = Omit<DashboardSubNavigationItem, 'categoryId' | 'navigationJobId'>;

type DashboardNavigationCategorySetting = DashboardCategoryDefinition & {
    items: readonly DashboardSubNavigationSetting[];
};

export type DashboardNavigationEntry =
    | {
          category: DashboardNavigationJobDefinition;
          defaultSubNavigationTo?: DashboardSubNavigationTo;
          linkTo: DashboardCategoryTo | DashboardSubNavigationTo;
          subNavigation: readonly DashboardSubNavigationItem[];
          type: 'direct';
      }
    | {
          category: DashboardNavigationJobDefinition;
          defaultSubNavigationTo: DashboardSubNavigationTo;
          linkTo: DashboardSubNavigationTo;
          subNavigation: readonly DashboardSubNavigationItem[];
          type: 'group';
      };

const dashboardNavigationSettings = [
    {
        id: 'overview',
        label: 'Overview',
        path: '',
        to: '/dashboard/$guildId',
        description: 'Server pulse, activity, and operational health.',
        icon: BarChart3,
        items: [],
    },
    {
        id: 'messaging',
        label: 'Messaging',
        path: 'messaging',
        to: '/dashboard/$guildId/messaging',
        description: 'Message composition and delivery.',
        icon: MessageSquareText,
        items: [
            subNavigation(
                'message-builder',
                'Message Builder',
                'Compose, preview, and post Fluxer messages.',
                '/dashboard/$guildId/messaging/message-builder',
                MessageSquarePlus,
                'full'
            ),
        ],
    },
    {
        id: 'general',
        label: 'General Settings',
        path: 'general',
        to: '/dashboard/$guildId/general',
        description: 'Core bot behavior and command settings.',
        icon: Settings2,
        items: [
            subNavigation(
                'command-prefix',
                'Command Prefix',
                'Change the bot command prefix.',
                '/dashboard/$guildId/general/command-prefix',
                Terminal,
                'full'
            ),
        ],
    },
    {
        id: 'events',
        label: 'Events & Logs',
        path: 'events',
        to: '/dashboard/$guildId/events',
        description: 'Audit and operational event history.',
        icon: BellDot,
        items: [
            subNavigation(
                'audit-events',
                'Audit Events',
                'Search persisted dashboard and bot changes.',
                '/dashboard/$guildId/events/audit-events',
                ScrollText,
                'full'
            ),
        ],
    },
    {
        id: 'structure',
        label: 'Server Blueprint',
        path: 'structure',
        to: '/dashboard/$guildId/structure',
        description: 'Inspect, compare, back up, and safely deploy server layout changes.',
        icon: GitBranch,
        items: [],
    },
] as const satisfies readonly DashboardNavigationCategorySetting[];

const dashboardNavigationJobs = [
    {
        id: 'overview',
        label: 'Overview',
        description: 'Server pulse, attention, and recent activity.',
        icon: BarChart3,
        routeCategoryIds: ['overview'],
    },
    {
        id: 'create-deliver',
        label: 'Create & Deliver',
        description: 'Compose messages and manage outbound delivery.',
        icon: MessageSquareText,
        routeCategoryIds: ['messaging'],
    },
    {
        id: 'insights-activity',
        label: 'Insights & Activity',
        description: 'Audit events and operational history.',
        icon: ChartNoAxesCombined,
        routeCategoryIds: ['events'],
    },
    {
        id: 'blueprint',
        label: 'Server Blueprint',
        description: 'Inspect, compare, back up, and safely deploy server layout changes.',
        icon: GitBranch,
        routeCategoryIds: ['structure'],
    },
    {
        id: 'settings',
        label: 'Settings',
        description: 'Bot behavior and server settings.',
        icon: Settings2,
        routeCategoryIds: ['general'],
    },
] as const satisfies readonly DashboardNavigationJobDefinition[];

export const dashboardCategories = dashboardNavigationSettings.map(({ items: _items, ...category }) => category);

export const dashboardCapabilities = dashboardNavigationSettings.flatMap((setting) =>
    setting.items.map(
        (item): DashboardSubNavigationItem => ({
            ...item,
            categoryId: setting.id,
            navigationJobId: getCapabilityNavigationJobId(setting.id),
        })
    )
);

export const dashboardNavigationEntries = dashboardNavigationJobs.map((job): DashboardNavigationEntry => {
    const jobSubNavigation = dashboardCapabilities.filter((item) => item.navigationJobId === job.id);
    const defaultSubNavigationTo = jobSubNavigation.at(0)?.to;
    const directCategory = getDirectNavigationCategory(job.id);

    return {
        category: job,
        ...(defaultSubNavigationTo ? { defaultSubNavigationTo } : {}),
        linkTo: defaultSubNavigationTo ?? directCategory?.to ?? '/dashboard/$guildId',
        subNavigation: jobSubNavigation,
        type: 'direct',
    };
});

export function getDashboardCategory(id: DashboardCategoryId): DashboardCategoryDefinition {
    const category = dashboardCategories.find((candidate) => candidate.id === id);

    if (!category) throw new Error(`Unknown dashboard category: ${id}`);
    return category;
}

export function getDashboardCategorySubNavigation(id: DashboardCategoryId): readonly DashboardSubNavigationItem[] {
    return dashboardCapabilities.filter((item) => item.categoryId === id);
}

export function getDashboardNavigationJob(id: DashboardNavigationJobId): DashboardNavigationJobDefinition {
    const job = dashboardNavigationJobs.find((candidate) => candidate.id === id);

    if (!job) throw new Error(`Unknown dashboard navigation job: ${id}`);
    return job;
}

export function getRequiredDefaultDashboardSubNavigationTo(id: DashboardCategoryId): DashboardSubNavigationTo {
    const to = getDashboardCategorySubNavigation(id).at(0)?.to;

    if (!to) throw new Error(`Dashboard category has no default sub navigation item: ${id}`);
    return to;
}

export function getDashboardCategoryIdFromPathname(guildId: string, pathname: string): DashboardCategoryId {
    const guildPathPrefix = `/dashboard/${guildId}`;

    if (pathname === guildPathPrefix || pathname === `${guildPathPrefix}/`) return 'overview';

    const categoryPath =
        pathname
            .slice(guildPathPrefix.length + 1)
            .split('/')
            .at(0) ?? '';
    return dashboardCategories.find((candidate) => candidate.path === categoryPath)?.id ?? 'overview';
}

function getDirectNavigationCategory(jobId: DashboardNavigationJobId): DashboardCategoryDefinition | undefined {
    switch (jobId) {
        case 'overview':
            return getDashboardCategory('overview');
        case 'blueprint':
            return getDashboardCategory('structure');
        default:
            return undefined;
    }
}

function getCapabilityNavigationJobId(categoryId: DashboardCategoryId): DashboardNavigationJobId {
    switch (categoryId) {
        case 'messaging':
            return 'create-deliver';
        case 'events':
            return 'insights-activity';
        case 'general':
            return 'settings';
        case 'overview':
            return 'overview';
        case 'structure':
            return 'blueprint';
    }
}

function subNavigation(
    id: string,
    label: string,
    description: string,
    to: DashboardSubNavigationTo,
    icon: LucideIcon,
    pageWidth: DashboardSubNavigationItem['pageWidth'] = 'standard'
): DashboardSubNavigationSetting {
    return { id, label, description, to, icon, pageWidth };
}
