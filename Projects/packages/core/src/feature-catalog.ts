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
    moderation: 'Moderation',
    settings: 'Settings',
    suggestions: 'Suggestions',
    xp: 'XP',
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

const plannedCommands = [
    plannedCommand('moderation.kick', 'moderation', 'kick', DEFCON_FEATURE_CATEGORY.moderation),
    plannedCommand('moderation.ban', 'moderation', 'ban', DEFCON_FEATURE_CATEGORY.moderation),
    plannedCommand('moderation.unban', 'moderation', 'unban', DEFCON_FEATURE_CATEGORY.moderation),
    plannedCommand('moderation.timeout', 'moderation', 'timeout', DEFCON_FEATURE_CATEGORY.moderation),
    plannedCommand('moderation.warn', 'moderation', 'warn', DEFCON_FEATURE_CATEGORY.moderation),
    plannedCommand('suggestions.suggest', 'suggestions', 'suggest', DEFCON_FEATURE_CATEGORY.suggestions),
    plannedCommand('xp.rank', 'xp', 'rank', DEFCON_FEATURE_CATEGORY.xp),
    plannedCommand('xp.leaderboard', 'xp', 'leaderboard', DEFCON_FEATURE_CATEGORY.xp),
] as const satisfies readonly BotCommandDefinition[];

export const FEATURE_SURFACES: readonly FeatureSurfaceDefinition[] = [
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
        id: 'access',
        label: 'Command access',
        kinds: ['dashboard-config'],
        dashboardConfigs: [dashboardConfig('access.command_grants', 'access', 'Command grants', true)],
    },
    {
        id: 'moderation',
        label: 'Moderation',
        kinds: ['dashboard-config', 'bot-command', 'event-handler'],
        dashboardConfigs: [dashboardConfig('moderation.policy', 'moderation', 'Moderation policy', false)],
        botCommands: plannedCommands.filter((command) => command.categoryId === 'moderation'),
        eventHandlers: [eventHandler('moderation.events', ['message.created', 'ban.added', 'ban.removed'], false)],
    },
    {
        id: 'logging',
        label: 'Server event logging',
        kinds: ['dashboard-config', 'event-handler'],
        dashboardConfigs: [dashboardConfig('logging.destinations', 'logging', 'Event log destinations', false)],
        eventHandlers: [
            eventHandler(
                'logging.events',
                [
                    'message.updated',
                    'message.deleted',
                    'member.joined',
                    'member.left',
                    'ban.added',
                    'ban.removed',
                    'role.created',
                    'role.updated',
                    'role.deleted',
                    'channel.created',
                    'channel.updated',
                    'channel.deleted',
                    'voice_state.updated',
                ],
                false
            ),
        ],
    },
    featureWithConfig('autorole', 'Autorole', 'access', ['member.joined']),
    featureWithConfig('reaction_roles', 'Reaction roles', 'access', ['reaction.added', 'reaction.removed']),
    featureWithConfig('verification', 'Verification', 'access', ['member.joined', 'reaction.added']),
    featureWithConfig('tickets', 'Tickets', 'community', ['message.created', 'channel.deleted']),
    {
        id: 'suggestions',
        label: 'Suggestions',
        kinds: ['dashboard-config', 'bot-command', 'event-handler'],
        dashboardConfigs: [dashboardConfig('suggestions.workflow', 'community', 'Suggestion workflow', false)],
        botCommands: plannedCommands.filter((command) => command.categoryId === 'suggestions'),
        eventHandlers: [
            eventHandler('suggestions.events', ['message.created', 'reaction.added', 'reaction.removed'], false),
        ],
    },
    {
        id: 'posting',
        label: 'Dashboard posting',
        kinds: ['dashboard-config'],
        dashboardConfigs: [dashboardConfig('posting.dashboard_sender', 'messaging', 'Dashboard message sender', true)],
    },
    featureWithConfig('profile_builder', 'Profile builder', 'community', ['message.created']),
    {
        id: 'xp',
        label: 'XP and levels',
        kinds: ['dashboard-config', 'bot-command', 'event-handler'],
        dashboardConfigs: [dashboardConfig('xp.rules', 'community', 'XP rules', false)],
        botCommands: plannedCommands.filter((command) => command.categoryId === 'xp'),
        eventHandlers: [eventHandler('xp.activity', ['message.created', 'voice_state.updated'], false)],
    },
    {
        id: 'vc_generator',
        label: 'VC generator',
        kinds: ['dashboard-config', 'bot-managed-panel', 'event-handler'],
        dashboardConfigs: [dashboardConfig('vc_generator.panel', 'community', 'Generator panel', false)],
        botManagedPanels: [
            {
                id: 'vc_generator.control_panel',
                dashboardCategoryId: 'community',
                label: 'Voice channel control panel',
                implemented: false,
                controlMode: 'reaction',
                controlNames: ['rename', 'user_limit', 'whitelist', 'blacklist', 'lock', 'unlock'],
            },
        ],
        eventHandlers: [eventHandler('vc_generator.events', ['voice_state.updated', 'channel.deleted'], false)],
    },
    featureWithConfig('role_reconciliation', 'Role reconciliation', 'access', [
        'member.updated',
        'role.updated',
        'role.deleted',
    ]),
    featureWithConfig('import_export', 'Import and export', 'structure', [
        'guild.lifecycle.updated',
        'role.created',
        'role.updated',
        'role.deleted',
        'channel.created',
        'channel.updated',
        'channel.deleted',
    ]),
    {
        id: 'invite_tracking',
        label: 'Invite tracking',
        kinds: ['dashboard-config', 'event-handler'],
        dashboardConfigs: [dashboardConfig('invite_tracking.analytics', 'invites', 'Invite tracking analytics', true)],
        eventHandlers: [eventHandler('invite_tracking.events', ['member.joined', 'member.left'], true)],
    },
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

function plannedCommand(
    id: string,
    categoryId: keyof typeof BOT_COMMAND_CATEGORY_TITLES,
    commandName: string,
    defconCategory: DefconFeatureCategory
): BotCommandDefinition {
    return {
        id,
        categoryId,
        categoryTitle: BOT_COMMAND_CATEGORY_TITLES[categoryId],
        commandName,
        usage: (prefix) => `${prefix}${commandName}`,
        description: 'Planned command scaffold.',
        defconCategory,
        audience: 'guarded',
        visibleInHelp: false,
        implemented: false,
        grantable: false,
    };
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

function featureWithConfig(
    id: string,
    label: string,
    dashboardCategoryId: string,
    eventTypes: readonly string[]
): FeatureSurfaceDefinition {
    return {
        id,
        label,
        kinds: ['dashboard-config', 'event-handler'],
        dashboardConfigs: [dashboardConfig(`${id}.settings`, dashboardCategoryId, `${label} settings`, false)],
        eventHandlers: [eventHandler(`${id}.events`, eventTypes, false)],
    };
}
