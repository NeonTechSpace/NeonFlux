import {
    Activity,
    BarChart3,
    BellDot,
    Bot,
    Boxes,
    ChartNoAxesCombined,
    FileQuestion,
    Gamepad2,
    Gift,
    GitBranch,
    GitCompareArrows,
    Globe,
    HelpCircle,
    KeyRound,
    Library,
    MessageSquareText,
    Radio,
    ScrollText,
    ServerCog,
    Settings2,
    ShieldCheck,
    Sparkles,
    TerminalSquare,
    TicketCheck,
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
    | '/dashboard/$guildId/access/reaction-roles'
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
    | '/dashboard/$guildId/system/convex-dashboard-data'
    | '/dashboard/$guildId/system/deployment'
    | '/dashboard/$guildId/system/documentation'
    | '/dashboard/$guildId/system/oauth-sessions'
    | '/dashboard/$guildId/system/public-web-links';

export type DashboardCategoryDefinition = {
    id: DashboardCategoryId;
    label: string;
    path: string;
    to: DashboardCategoryTo;
    description: string;
    icon: LucideIcon;
    status: 'active' | 'planned';
};

export type DashboardSubNavigationItem = {
    id: string;
    label: string;
    description: string;
    to: DashboardSubNavigationTo;
    icon: LucideIcon;
    implemented: boolean;
    status: 'implemented' | 'placeholder';
};

export type DashboardNavigationCategorySetting = DashboardCategoryDefinition & {
    items: readonly DashboardSubNavigationItem[];
};

export type DashboardNavigationEntry =
    | {
          category: DashboardCategoryDefinition;
          defaultSubNavigationTo?: DashboardSubNavigationTo;
          linkTo: DashboardCategoryTo | DashboardSubNavigationTo;
          subNavigation: readonly DashboardSubNavigationItem[];
          type: 'direct';
      }
    | {
          category: DashboardCategoryDefinition;
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
];

export const dashboardNavigationSettings = [
    {
        id: 'overview',
        label: 'Overview',
        path: '',
        to: '/dashboard/$guildId',
        description: 'Server pulse, activity, and operational health.',
        icon: BarChart3,
        status: 'active',
        items: [],
    },
    {
        id: 'messaging',
        label: 'Messaging',
        path: 'messaging',
        to: '/dashboard/$guildId/messaging',
        description: 'Message composition, publishing, and future outbound feeds.',
        icon: MessageSquareText,
        status: 'active',
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
                MessageSquareText
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
        status: 'planned',
        items: [
            placeholder(
                'automod',
                'Automod',
                'Planned automated moderation rules.',
                '/dashboard/$guildId/moderation/automod',
                Bot
            ),
            placeholder(
                'cases',
                'Cases',
                'Planned moderation case history.',
                '/dashboard/$guildId/moderation/cases',
                ScrollText
            ),
            placeholder(
                'policy',
                'Policy',
                'Planned moderation policy settings.',
                '/dashboard/$guildId/moderation/policy',
                ShieldCheck
            ),
        ],
    },
    {
        id: 'access',
        label: 'Roles & Access',
        path: 'access',
        to: '/dashboard/$guildId/access',
        description: 'Role automation, grants, verification, and reaction roles.',
        icon: ShieldCheck,
        status: 'active',
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
            implemented(
                'reaction-roles',
                'Reaction Roles',
                'Build reaction-backed role menus.',
                '/dashboard/$guildId/access/reaction-roles',
                ShieldCheck
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
        status: 'planned',
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
                TicketCheck
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
        status: 'planned',
        items: [
            placeholder(
                'growth-tracking',
                'Growth Tracking',
                'Planned member movement analytics.',
                '/dashboard/$guildId/insights/growth-tracking',
                ChartNoAxesCombined
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
        status: 'active',
        items: [
            placeholder(
                'bot-presence',
                'Bot Presence',
                'Planned status and presence settings.',
                '/dashboard/$guildId/general/bot-presence',
                Radio
            ),
            placeholder(
                'command-help',
                'Command Help',
                'Planned help visibility settings.',
                '/dashboard/$guildId/general/command-help',
                HelpCircle
            ),
            implemented(
                'command-prefix',
                'Command Prefix',
                'Change the bot command prefix.',
                '/dashboard/$guildId/general/command-prefix',
                Settings2
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
        status: 'planned',
        items: [
            implemented(
                'audit-events',
                'Audit Events',
                'Search persisted dashboard and bot changes.',
                '/dashboard/$guildId/events/audit-events',
                ScrollText
            ),
            placeholder(
                'logging-destinations',
                'Logging Destinations',
                'Planned server-event logging destinations.',
                '/dashboard/$guildId/events/logging-destinations',
                BellDot
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
        status: 'active',
        items: [],
    },
    {
        id: 'system',
        label: 'System',
        path: 'system',
        to: '/dashboard/$guildId/system',
        description: 'Future deployment, session, documentation, and platform controls.',
        icon: ServerCog,
        status: 'planned',
        items: [
            placeholder(
                'bot-installation-sync',
                'Bot Installation Sync',
                'Planned installation reconciliation visibility.',
                '/dashboard/$guildId/system/bot-installation-sync',
                Bot
            ),
            placeholder(
                'convex-dashboard-data',
                'Convex Dashboard Data',
                'Planned Convex-backed dashboard data status.',
                '/dashboard/$guildId/system/convex-dashboard-data',
                Boxes
            ),
            placeholder(
                'deployment',
                'Deployment',
                'Planned deployment and image status.',
                '/dashboard/$guildId/system/deployment',
                TerminalSquare
            ),
            placeholder(
                'documentation',
                'Documentation',
                'Planned documentation status.',
                '/dashboard/$guildId/system/documentation',
                Library
            ),
            placeholder(
                'oauth-sessions',
                'OAuth Sessions',
                'Planned OAuth session controls.',
                '/dashboard/$guildId/system/oauth-sessions',
                KeyRound
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

export const dashboardCategories = dashboardNavigationSettings.map(({ items: _items, ...category }) => category);

export const dashboardNavigationEntries = dashboardNavigationSettings.map((setting): DashboardNavigationEntry => {
    const { items, ...category } = setting;
    const defaultSubNavigationTo = items.at(0)?.to;

    if (items.length > 1 && defaultSubNavigationTo) {
        return {
            category,
            defaultSubNavigationTo,
            linkTo: defaultSubNavigationTo,
            subNavigation: items,
            type: 'group',
        };
    }

    return {
        category,
        ...(defaultSubNavigationTo ? { defaultSubNavigationTo } : {}),
        linkTo: defaultSubNavigationTo ?? category.to,
        subNavigation: items,
        type: 'direct',
    };
});

export function getDashboardCategory(id: DashboardCategoryId): DashboardCategoryDefinition {
    const category = dashboardCategories.find((candidate) => candidate.id === id);

    if (!category) {
        throw new Error(`Unknown dashboard category: ${id}`);
    }

    return category;
}

export function getDashboardCategorySubNavigation(id: DashboardCategoryId): readonly DashboardSubNavigationItem[] {
    return getDashboardNavigationSetting(id).items;
}

export function getDashboardSubNavigationItem(id: DashboardCategoryId, itemId: string): DashboardSubNavigationItem {
    const item = getDashboardCategorySubNavigation(id).find((candidate) => candidate.id === itemId);

    if (!item) {
        throw new Error(`Unknown dashboard sub navigation item: ${id}/${itemId}`);
    }

    return item;
}

export function getDefaultDashboardSubNavigationTo(id: DashboardCategoryId): DashboardSubNavigationTo | undefined {
    return getDashboardCategorySubNavigation(id).at(0)?.to;
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

export function getDashboardNavigationEntry(id: DashboardCategoryId): DashboardNavigationEntry {
    const entry = dashboardNavigationEntries.find((candidate) => candidate.category.id === id);

    if (!entry) {
        throw new Error(`Unknown dashboard navigation entry: ${id}`);
    }

    return entry;
}

function getDashboardNavigationSetting(id: DashboardCategoryId): DashboardNavigationCategorySetting {
    const setting = dashboardNavigationSettings.find((candidate) => candidate.id === id);

    if (!setting) {
        throw new Error(`Unknown dashboard category: ${id}`);
    }

    return setting;
}

function implemented(...input: SubNavigationInput): DashboardSubNavigationItem {
    return subNavigationItem(input, true);
}

function placeholder(...input: SubNavigationInput): DashboardSubNavigationItem {
    return subNavigationItem(input, false);
}

function subNavigationItem(
    [id, label, description, to, icon]: SubNavigationInput,
    isImplemented: boolean
): DashboardSubNavigationItem {
    return {
        id,
        label,
        description,
        to,
        icon,
        implemented: isImplemented,
        status: isImplemented ? 'implemented' : 'placeholder',
    };
}
