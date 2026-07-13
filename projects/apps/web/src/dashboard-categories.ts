import {
    Activity,
    BarChart3,
    BellDot,
    Bot,
    ChartNoAxesCombined,
    FileQuestion,
    Gamepad2,
    Gift,
    GitBranch,
    GitCompareArrows,
    Globe,
    HelpCircle,
    KeyRound,
    Logs,
    MessageSquarePlus,
    MessageSquareText,
    Radio,
    ScrollText,
    ServerCog,
    Settings2,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    Terminal,
    TicketCheck,
    TrendingUp,
    Trophy,
    UserRoundCog,
    UsersRound,
    Volume2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type DashboardCategoryId =
    | 'overview'
    | 'messaging'
    | 'moderation'
    | 'access'
    | 'community'
    | 'insights'
    | 'general'
    | 'events'
    | 'structure'
    | 'system';

export type DashboardNavigationJobId =
    | 'overview'
    | 'create-deliver'
    | 'members-access'
    | 'community'
    | 'safety-support'
    | 'insights-activity'
    | 'blueprint'
    | 'settings';

type DashboardCategoryTo =
    | '/dashboard/$guildId'
    | '/dashboard/$guildId/messaging'
    | '/dashboard/$guildId/moderation'
    | '/dashboard/$guildId/access'
    | '/dashboard/$guildId/community'
    | '/dashboard/$guildId/insights'
    | '/dashboard/$guildId/general'
    | '/dashboard/$guildId/events'
    | '/dashboard/$guildId/structure'
    | '/dashboard/$guildId/system';

export type DashboardSubNavigationTo =
    | '/dashboard/$guildId/messaging/bluesky'
    | '/dashboard/$guildId/messaging/free-game-alerts'
    | '/dashboard/$guildId/messaging/message-builder'
    | '/dashboard/$guildId/moderation/automod'
    | '/dashboard/$guildId/moderation/cases'
    | '/dashboard/$guildId/moderation/policy'
    | '/dashboard/$guildId/access/autoroles'
    | '/dashboard/$guildId/access/command-access'
    | '/dashboard/$guildId/access/dashboard-access'
    | '/dashboard/$guildId/access/role-reconciliation'
    | '/dashboard/$guildId/access/verification'
    | '/dashboard/$guildId/community/giveaways'
    | '/dashboard/$guildId/community/profile-builder'
    | '/dashboard/$guildId/community/suggestions'
    | '/dashboard/$guildId/community/tickets'
    | '/dashboard/$guildId/community/voice-rooms'
    | '/dashboard/$guildId/community/xp'
    | '/dashboard/$guildId/insights/growth-tracking'
    | '/dashboard/$guildId/insights/invite-tracker'
    | '/dashboard/$guildId/general/bot-presence'
    | '/dashboard/$guildId/general/command-help'
    | '/dashboard/$guildId/general/command-prefix'
    | '/dashboard/$guildId/events/audit-events'
    | '/dashboard/$guildId/events/logging-destinations'
    | '/dashboard/$guildId/system/bot-installation-sync'
    | '/dashboard/$guildId/system/public-web-links';

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
    status: 'implemented' | 'placeholder';
};

export type DashboardNavigationJobDefinition = {
    id: DashboardNavigationJobId;
    label: string;
    description: string;
    icon: LucideIcon;
    routeCategoryIds: readonly DashboardCategoryId[];
};

type DashboardSubNavigationSetting = Omit<DashboardSubNavigationItem, 'categoryId' | 'navigationJobId' | 'scope'>;

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

type SubNavigationInput = [
    id: string,
    label: string,
    description: string,
    to: DashboardSubNavigationTo,
    icon: LucideIcon,
    pageWidth?: DashboardSubNavigationItem['pageWidth'],
];

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
        description: 'Message composition, publishing, and future outbound feeds.',
        icon: MessageSquareText,
        items: [
            placeholder(
                'bluesky',
                'Bluesky',
                'Planned Bluesky-to-Fluxer delivery settings.',
                '/dashboard/$guildId/messaging/bluesky',
                Sparkles
            ),
            placeholder(
                'free-game-alerts',
                'Free Game Alerts',
                'Planned free game alert delivery settings.',
                '/dashboard/$guildId/messaging/free-game-alerts',
                Gamepad2
            ),
            implemented(
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
        id: 'moderation',
        label: 'Moderation',
        path: 'moderation',
        to: '/dashboard/$guildId/moderation',
        description: 'Future policy, cases, and automated safety controls.',
        icon: Bot,
        items: [
            placeholder(
                'automod',
                'Automod',
                'Planned automated moderation rules.',
                '/dashboard/$guildId/moderation/automod',
                ShieldAlert
            ),
            placeholder(
                'cases',
                'Cases',
                'Planned moderation case history.',
                '/dashboard/$guildId/moderation/cases',
                ScrollText,
                'full'
            ),
            placeholder(
                'policy',
                'Policy',
                'Planned moderation policy settings.',
                '/dashboard/$guildId/moderation/policy',
                ShieldCheck,
                'full'
            ),
        ],
    },
    {
        id: 'access',
        label: 'Roles & Access',
        path: 'access',
        to: '/dashboard/$guildId/access',
        description: 'Role automation, grants, and verification.',
        icon: ShieldCheck,
        items: [
            placeholder(
                'autoroles',
                'Autoroles',
                'Planned join-role automation.',
                '/dashboard/$guildId/access/autoroles',
                Bot
            ),
            placeholder(
                'command-access',
                'Command Access',
                'Planned command grant management.',
                '/dashboard/$guildId/access/command-access',
                KeyRound
            ),
            placeholder(
                'dashboard-access',
                'Dashboard Access',
                'Planned dashboard permission management.',
                '/dashboard/$guildId/access/dashboard-access',
                UsersRound
            ),
            placeholder(
                'role-reconciliation',
                'Role Reconciliation',
                'Planned role drift repair.',
                '/dashboard/$guildId/access/role-reconciliation',
                GitCompareArrows
            ),
            placeholder(
                'verification',
                'Verification',
                'Planned verification role flows.',
                '/dashboard/$guildId/access/verification',
                Activity
            ),
        ],
    },
    {
        id: 'community',
        label: 'Community',
        path: 'community',
        to: '/dashboard/$guildId/community',
        description: 'Future community workflows and member-facing systems.',
        icon: UsersRound,
        items: [
            placeholder(
                'giveaways',
                'Giveaways',
                'Planned giveaway campaigns.',
                '/dashboard/$guildId/community/giveaways',
                Gift
            ),
            placeholder(
                'profile-builder',
                'Profile Builder',
                'Planned profile form and review workflow.',
                '/dashboard/$guildId/community/profile-builder',
                UserRoundCog
            ),
            placeholder(
                'suggestions',
                'Suggestions',
                'Planned suggestion voting.',
                '/dashboard/$guildId/community/suggestions',
                FileQuestion
            ),
            placeholder(
                'tickets',
                'Tickets',
                'Planned public and private tickets.',
                '/dashboard/$guildId/community/tickets',
                TicketCheck,
                'full'
            ),
            placeholder(
                'voice-rooms',
                'Voice Rooms',
                'Planned join-to-create voice rooms.',
                '/dashboard/$guildId/community/voice-rooms',
                Volume2
            ),
            placeholder('xp', 'XP / Levels', 'Planned XP and levels.', '/dashboard/$guildId/community/xp', Trophy),
        ],
    },
    {
        id: 'insights',
        label: 'Insights',
        path: 'insights',
        to: '/dashboard/$guildId/insights',
        description: 'Future growth analytics and invite attribution workspaces.',
        icon: ChartNoAxesCombined,
        items: [
            placeholder(
                'growth-tracking',
                'Growth Tracking',
                'Planned member movement analytics.',
                '/dashboard/$guildId/insights/growth-tracking',
                TrendingUp
            ),
            placeholder(
                'invite-tracker',
                'Invite Tracker',
                'Planned invite attribution.',
                '/dashboard/$guildId/insights/invite-tracker',
                TicketCheck
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
            placeholder(
                'bot-presence',
                'Bot Presence',
                'Planned status and presence settings.',
                '/dashboard/$guildId/general/bot-presence',
                Radio,
                'focused'
            ),
            placeholder(
                'command-help',
                'Command Help',
                'Planned help visibility settings.',
                '/dashboard/$guildId/general/command-help',
                HelpCircle,
                'focused'
            ),
            implemented(
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
        description: 'Future audit and logging exploration.',
        icon: BellDot,
        items: [
            implemented(
                'audit-events',
                'Audit Events',
                'Search persisted dashboard and bot changes.',
                '/dashboard/$guildId/events/audit-events',
                ScrollText,
                'full'
            ),
            placeholder(
                'logging-destinations',
                'Logging Destinations',
                'Planned server-event logging destinations.',
                '/dashboard/$guildId/events/logging-destinations',
                Logs
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
    {
        id: 'system',
        label: 'Integrations',
        path: 'system',
        to: '/dashboard/$guildId/system',
        description: 'Guild-owned installation and public integration settings.',
        icon: ServerCog,
        items: [
            placeholder(
                'bot-installation-sync',
                'Bot Installation Sync',
                'Planned installation reconciliation visibility.',
                '/dashboard/$guildId/system/bot-installation-sync',
                Bot
            ),
            placeholder(
                'public-web-links',
                'Public Web Links',
                'Planned generated public links.',
                '/dashboard/$guildId/system/public-web-links',
                Globe
            ),
        ],
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
        id: 'members-access',
        label: 'Members & Access',
        description: 'Member roles, verification, and effective access.',
        icon: ShieldCheck,
        routeCategoryIds: ['access'],
    },
    {
        id: 'community',
        label: 'Community',
        description: 'Member programs and participation workflows.',
        icon: UsersRound,
        routeCategoryIds: ['community'],
    },
    {
        id: 'safety-support',
        label: 'Safety & Support',
        description: 'Moderation, policy, cases, and member support.',
        icon: Bot,
        routeCategoryIds: ['moderation', 'community'],
    },
    {
        id: 'insights-activity',
        label: 'Insights & Activity',
        description: 'Growth, attribution, audit events, and logging.',
        icon: ChartNoAxesCombined,
        routeCategoryIds: ['insights', 'events'],
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
        description: 'Bot behavior and guild-owned integration settings.',
        icon: Settings2,
        routeCategoryIds: ['general', 'system'],
    },
] as const satisfies readonly DashboardNavigationJobDefinition[];

export const dashboardCategories = dashboardNavigationSettings.map(({ items: _items, ...category }) => category);

export const dashboardCapabilities = dashboardNavigationSettings.flatMap((setting) =>
    setting.items.map(
        (item): DashboardSubNavigationItem => ({
            ...item,
            categoryId: setting.id,
            navigationJobId: getCapabilityNavigationJobId(setting.id, item.id),
        })
    )
);

export const dashboardNavigationEntries = dashboardNavigationJobs.flatMap((job): DashboardNavigationEntry[] => {
    const jobItems = dashboardCapabilities.filter((item) => item.navigationJobId === job.id);
    const availableItems = jobItems.filter((item) => item.status === 'implemented');
    const defaultSubNavigationTo = availableItems.at(0)?.to;
    const directCategory = getDirectNavigationCategory(job.id);

    if (!directCategory && availableItems.length === 0) {
        return [];
    }

    if (!directCategory && jobItems.length > 1 && defaultSubNavigationTo) {
        return [
            {
                category: job,
                defaultSubNavigationTo,
                linkTo: defaultSubNavigationTo,
                subNavigation: availableItems,
                type: 'group',
            },
        ];
    }

    return [
        {
            category: job,
            ...(defaultSubNavigationTo ? { defaultSubNavigationTo } : {}),
            linkTo: defaultSubNavigationTo ?? directCategory?.to ?? '/dashboard/$guildId',
            subNavigation: availableItems,
            type: 'direct',
        },
    ];
});

export function getDashboardCategory(id: DashboardCategoryId): DashboardCategoryDefinition {
    const category = dashboardCategories.find((candidate) => candidate.id === id);

    if (!category) {
        throw new Error(`Unknown dashboard category: ${id}`);
    }

    return category;
}

export function getDashboardCategorySubNavigation(id: DashboardCategoryId): readonly DashboardSubNavigationItem[] {
    return dashboardCapabilities.filter((item) => item.categoryId === id);
}

export function getDashboardNavigationJob(id: DashboardNavigationJobId): DashboardNavigationJobDefinition {
    const job = dashboardNavigationJobs.find((candidate) => candidate.id === id);

    if (!job) {
        throw new Error(`Unknown dashboard navigation job: ${id}`);
    }

    return job;
}

export function getDashboardSubNavigationItem(id: DashboardCategoryId, itemId: string): DashboardSubNavigationItem {
    const item = getDashboardCategorySubNavigation(id).find((candidate) => candidate.id === itemId);

    if (!item) {
        throw new Error(`Unknown dashboard sub navigation item: ${id}/${itemId}`);
    }

    return item;
}

function getDefaultDashboardSubNavigationTo(id: DashboardCategoryId): DashboardSubNavigationTo | undefined {
    const items = getDashboardCategorySubNavigation(id);

    // Existing category index routes remain compatible while preferring a surface that
    // users can actually operate when one is available.
    return items.find((item) => item.status === 'implemented')?.to ?? items.at(0)?.to;
}

export function getRequiredDefaultDashboardSubNavigationTo(id: DashboardCategoryId): DashboardSubNavigationTo {
    const to = getDefaultDashboardSubNavigationTo(id);

    if (!to) {
        throw new Error(`Dashboard category has no default sub navigation item: ${id}`);
    }

    return to;
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

function getCapabilityNavigationJobId(categoryId: DashboardCategoryId, itemId: string): DashboardNavigationJobId {
    switch (categoryId) {
        case 'messaging':
            return 'create-deliver';
        case 'access':
            return 'members-access';
        case 'community':
            return itemId === 'tickets' ? 'safety-support' : 'community';
        case 'moderation':
            return 'safety-support';
        case 'insights':
        case 'events':
            return 'insights-activity';
        case 'general':
        case 'system':
            return 'settings';
        case 'overview':
            return 'overview';
        case 'structure':
            return 'blueprint';
    }
}

function implemented(...input: SubNavigationInput): DashboardSubNavigationSetting {
    return subNavigationItem(input, true);
}

function placeholder(...input: SubNavigationInput): DashboardSubNavigationSetting {
    return subNavigationItem(input, false);
}

function subNavigationItem(
    [id, label, description, to, icon, pageWidth = 'standard']: SubNavigationInput,
    isImplemented: boolean
): DashboardSubNavigationSetting {
    return {
        id,
        label,
        description,
        to,
        icon,
        pageWidth,
        status: isImplemented ? 'implemented' : 'placeholder',
    };
}
