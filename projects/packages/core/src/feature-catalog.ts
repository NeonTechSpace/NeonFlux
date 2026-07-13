import { DEFCON_FEATURE_CATEGORY, type DefconAudience, type DefconFeatureCategory } from './defcon.js';

export type FeatureSurfaceKind = 'dashboard-config' | 'bot-command' | 'bot-managed-panel' | 'event-handler';

export type BotCommandDefinition = {
    id: string;
    categoryId: string;
    categoryTitle: string;
    commandName: string;
    usage: (prefix: string) => string;
    description: string;
    defconCategory: DefconFeatureCategory;
    audience: DefconAudience;
    visibleInHelp: boolean;
    implemented: boolean;
    grantable: boolean;
};

export type DashboardConfigSurfaceDefinition = {
    id: string;
    dashboardCategoryId: string;
    label: string;
    implemented: boolean;
};

export type BotManagedPanelDefinition = {
    id: string;
    dashboardCategoryId: string;
    label: string;
    implemented: boolean;
    controlMode: 'reaction' | 'interaction';
    controlNames: readonly string[];
};

export type FeatureEventHandlerDefinition = {
    id: string;
    eventTypes: readonly string[];
    implemented: boolean;
};

export type FeatureSurfaceDefinition = {
    id: string;
    label: string;
    kinds: readonly FeatureSurfaceKind[];
    dashboardConfigs?: readonly DashboardConfigSurfaceDefinition[];
    botCommands?: readonly BotCommandDefinition[];
    botManagedPanels?: readonly BotManagedPanelDefinition[];
    eventHandlers?: readonly FeatureEventHandlerDefinition[];
};

export const BOT_COMMAND_CATEGORY_TITLES = {
    general: 'General',
    settings: 'Settings',
} as const satisfies Record<string, string>;

const liveCommands = [
    {
        id: 'general.help',
        categoryId: 'general',
        categoryTitle: BOT_COMMAND_CATEGORY_TITLES.general,
        commandName: 'help',
        usage: (prefix: string) => `${prefix}help [category]`,
        description: 'Show command help pages.',
        defconCategory: DEFCON_FEATURE_CATEGORY.help,
        audience: 'public',
        visibleInHelp: true,
        implemented: true,
        grantable: false,
    },
    {
        id: 'general.ping',
        categoryId: 'general',
        categoryTitle: BOT_COMMAND_CATEGORY_TITLES.general,
        commandName: 'ping',
        usage: (prefix: string) => `${prefix}ping`,
        description: 'Check whether NeonFlux can reply in this channel.',
        defconCategory: DEFCON_FEATURE_CATEGORY.botMention,
        audience: 'public',
        visibleInHelp: true,
        implemented: true,
        grantable: false,
    },
    {
        id: 'settings.prefix',
        categoryId: 'settings',
        categoryTitle: BOT_COMMAND_CATEGORY_TITLES.settings,
        commandName: 'prefix',
        usage: () => '@NeonFlux prefix ?',
        description: 'Change the command prefix. Requires Manage Server or an allowed role/user rule.',
        defconCategory: DEFCON_FEATURE_CATEGORY.prefix,
        audience: 'guarded',
        visibleInHelp: true,
        implemented: true,
        grantable: true,
    },
] as const satisfies readonly BotCommandDefinition[];

export const FEATURE_SURFACES: readonly FeatureSurfaceDefinition[] = [
    {
        id: 'overview',
        label: 'Overview',
        kinds: ['dashboard-config', 'event-handler'],
        dashboardConfigs: [dashboardConfig('overview.metrics', 'overview', 'Overview metrics', true)],
        eventHandlers: [eventHandler('overview.growth', ['member.joined', 'member.left', 'message.created'], true)],
    },
    {
        id: 'general',
        label: 'General commands',
        kinds: ['bot-command'],
        botCommands: liveCommands.filter((command) => command.categoryId === 'general'),
    },
    {
        id: 'settings',
        label: 'Command settings',
        kinds: ['dashboard-config', 'bot-command'],
        dashboardConfigs: [dashboardConfig('general.command_prefix', 'general', 'Command prefix', true)],
        botCommands: liveCommands.filter((command) => command.categoryId === 'settings'),
    },
    {
        id: 'posting',
        label: 'Dashboard posting',
        kinds: ['dashboard-config'],
        dashboardConfigs: [dashboardConfig('posting.dashboard_sender', 'messaging', 'Dashboard message sender', true)],
    },
    {
        id: 'audit',
        label: 'Audit events',
        kinds: ['dashboard-config'],
        dashboardConfigs: [dashboardConfig('audit.events', 'events', 'Audit events', true)],
    },
    {
        id: 'import_export',
        label: 'Import and export',
        kinds: ['dashboard-config', 'event-handler'],
        dashboardConfigs: [
            dashboardConfig('import_export.dry_run', 'structure', 'Server blueprint import/export', true),
        ],
        eventHandlers: [
            eventHandler(
                'import_export.events',
                [
                    'guild.lifecycle.updated',
                    'role.created',
                    'role.updated',
                    'role.deleted',
                    'channel.created',
                    'channel.updated',
                    'channel.deleted',
                ],
                true
            ),
        ],
    },
    plannedSurface('automod', 'Automod', 'moderation'),
    plannedSurface('autorole', 'Autorole', 'access'),
    plannedSurface('bluesky', 'Bluesky', 'messaging'),
    plannedSurface('bot_presence', 'Bot presence', 'general'),
    plannedSurface('command_access', 'Command access', 'access'),
    plannedSurface('dashboard_access', 'Dashboard access', 'access'),
    plannedSurface('free_game_alerts', 'Free game alerts', 'messaging'),
    plannedSurface('giveaways', 'Giveaways', 'community'),
    plannedSurface('invite_tracking', 'Invite tracking', 'insights'),
    plannedSurface('logging', 'Server event logging', 'events'),
    plannedSurface('moderation', 'Moderation', 'moderation'),
    plannedSurface('profile_builder', 'Profile builder', 'community'),
    plannedSurface('role_reconciliation', 'Role reconciliation', 'access'),
    plannedSurface('suggestions', 'Suggestions', 'community'),
    plannedSurface('tickets', 'Tickets', 'community'),
    plannedSurface('voice_rooms', 'Voice rooms', 'community'),
    plannedSurface('verification', 'Verification', 'access'),
    plannedSurface('xp', 'XP and levels', 'community'),
];

export function listBotCommandDefinitions(): BotCommandDefinition[] {
    return FEATURE_SURFACES.flatMap((surface) => surface.botCommands ?? []);
}

export function listImplementedBotCommandDefinitions(): BotCommandDefinition[] {
    return listBotCommandDefinitions().filter((command) => command.implemented);
}

export function listGrantableBotCommandDefinitions(): BotCommandDefinition[] {
    return listBotCommandDefinitions().filter((command) => command.implemented && command.grantable);
}

export function listGrantableBotCommandCategories(): Array<{ id: string; title: string }> {
    const categoriesById = new Map<string, { id: string; title: string }>();

    for (const command of listGrantableBotCommandDefinitions()) {
        categoriesById.set(command.categoryId, {
            id: command.categoryId,
            title: command.categoryTitle,
        });
    }

    return [...categoriesById.values()];
}

export function findBotCommandDefinition(commandId: string): BotCommandDefinition | undefined {
    return listBotCommandDefinitions().find((command) => command.id === commandId);
}

function dashboardConfig(
    id: string,
    dashboardCategoryId: string,
    label: string,
    implemented: boolean
): DashboardConfigSurfaceDefinition {
    return {
        id,
        dashboardCategoryId,
        label,
        implemented,
    };
}

function eventHandler(id: string, eventTypes: readonly string[], implemented: boolean): FeatureEventHandlerDefinition {
    return {
        id,
        eventTypes,
        implemented,
    };
}

function plannedSurface(id: string, label: string, dashboardCategoryId: string): FeatureSurfaceDefinition {
    return {
        id,
        label,
        kinds: ['dashboard-config'],
        dashboardConfigs: [dashboardConfig(`${id}.placeholder`, dashboardCategoryId, label, false)],
    };
}
