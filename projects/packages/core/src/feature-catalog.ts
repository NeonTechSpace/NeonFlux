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
    {
        id: 'suggestions.suggest',
        categoryId: 'suggestions',
        categoryTitle: BOT_COMMAND_CATEGORY_TITLES.suggestions,
        commandName: 'suggest',
        usage: (prefix: string) => `${prefix}suggest <idea>`,
        description: 'Submit a suggestion to the configured suggestion board.',
        defconCategory: DEFCON_FEATURE_CATEGORY.suggestions,
        audience: 'public',
        visibleInHelp: true,
        implemented: true,
        grantable: false,
    },
    {
        id: 'xp.rank',
        categoryId: 'xp',
        categoryTitle: BOT_COMMAND_CATEGORY_TITLES.xp,
        commandName: 'rank',
        usage: (prefix: string) => `${prefix}rank [user]`,
        description: 'Show XP rank, level, and message/voice XP totals.',
        defconCategory: DEFCON_FEATURE_CATEGORY.xp,
        audience: 'public',
        visibleInHelp: true,
        implemented: true,
        grantable: false,
    },
    {
        id: 'xp.leaderboard',
        categoryId: 'xp',
        categoryTitle: BOT_COMMAND_CATEGORY_TITLES.xp,
        commandName: 'leaderboard',
        usage: (prefix: string) => `${prefix}leaderboard`,
        description: 'Show the top XP users in this server.',
        defconCategory: DEFCON_FEATURE_CATEGORY.xp,
        audience: 'public',
        visibleInHelp: true,
        implemented: true,
        grantable: false,
    },
    guardedCommand({
        id: 'moderation.warn',
        commandName: 'warn',
        usage: (prefix) => `${prefix}warn <user> [reason]`,
        description: 'Record a warning case for a user.',
    }),
    guardedCommand({
        id: 'moderation.kick',
        commandName: 'kick',
        usage: (prefix) => `${prefix}kick <user> [reason]`,
        description: 'Kick a user and record a moderation case.',
    }),
    guardedCommand({
        id: 'moderation.ban',
        commandName: 'ban',
        usage: (prefix) => `${prefix}ban <user> [reason]`,
        description: 'Ban a user and record a moderation case.',
    }),
    guardedCommand({
        id: 'moderation.unban',
        commandName: 'unban',
        usage: (prefix) => `${prefix}unban <user> [reason]`,
        description: 'Unban a user and record a moderation case.',
    }),
    guardedCommand({
        id: 'moderation.timeout',
        commandName: 'timeout',
        usage: (prefix) => `${prefix}timeout <user> <duration: 1m-28d> [reason]`,
        description: 'Timeout a user temporarily and record a moderation case.',
    }),
    guardedCommand({
        id: 'moderation.untimeout',
        commandName: 'untimeout',
        usage: (prefix) => `${prefix}untimeout <user> [reason]`,
        description: 'Remove a user timeout and record a moderation case.',
    }),
    guardedCommand({
        id: 'moderation.purge',
        commandName: 'purge',
        usage: (prefix) => `${prefix}purge <1-100> [reason]`,
        description: 'Delete recent messages in the current channel and record a moderation case.',
    }),
    guardedCommand({
        id: 'moderation.warnings',
        commandName: 'warnings',
        usage: (prefix) => `${prefix}warnings <user>`,
        description: 'List warning cases for a user.',
    }),
    guardedCommand({
        id: 'moderation.warning.delete',
        commandName: 'delwarn',
        usage: (prefix) => `${prefix}delwarn <case-number> [reason]`,
        description: 'Void one warning case.',
    }),
    guardedCommand({
        id: 'moderation.warnings.clear',
        commandName: 'clearwarn',
        usage: (prefix) => `${prefix}clearwarn <user> [reason]`,
        description: 'Void all open warning cases for a user.',
    }),
    guardedCommand({
        id: 'moderation.case',
        commandName: 'case',
        usage: (prefix) => `${prefix}case <case-number>`,
        description: 'Show one moderation case.',
    }),
    guardedCommand({
        id: 'moderation.cases',
        commandName: 'cases',
        usage: (prefix) => `${prefix}cases [user]`,
        description: 'List recent moderation cases, optionally for one user.',
    }),
    guardedCommand({
        id: 'moderation.reason',
        commandName: 'reason',
        usage: (prefix) => `${prefix}reason <case-number> <reason>`,
        description: 'Update the reason on a moderation case.',
    }),
    guardedCommand({
        id: 'moderation.note',
        commandName: 'note',
        usage: (prefix) => `${prefix}note <case-number> <note>`,
        description: 'Add a note to a moderation case.',
    }),
    guardedCommand({
        id: 'moderation.notes',
        commandName: 'notes',
        usage: (prefix) => `${prefix}notes <case-number>`,
        description: 'List notes on a moderation case.',
    }),
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
        dashboardConfigs: [dashboardConfig('moderation.policy', 'moderation', 'Moderation policy', true)],
        botCommands: liveCommands.filter((command) => command.categoryId === 'moderation'),
        eventHandlers: [
            eventHandler('moderation.commands', ['message.created'], true),
            eventHandler('moderation.events', ['ban.added', 'ban.removed'], true),
        ],
    },
    {
        id: 'automod',
        label: 'Automod',
        kinds: ['dashboard-config', 'event-handler'],
        dashboardConfigs: [dashboardConfig('automod.rules', 'moderation', 'Automod rules', true)],
        eventHandlers: [eventHandler('automod.events', ['message.created'], true)],
    },
    {
        id: 'logging',
        label: 'Server event logging',
        kinds: ['dashboard-config', 'event-handler'],
        dashboardConfigs: [dashboardConfig('logging.destinations', 'logging', 'Event log destinations', true)],
        eventHandlers: [
            eventHandler(
                'logging.events',
                [
                    'message.updated',
                    'message.deleted',
                    'member.joined',
                    'member.updated',
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
                true
            ),
        ],
    },
    {
        id: 'autorole',
        label: 'Autorole',
        kinds: ['dashboard-config', 'event-handler'],
        dashboardConfigs: [dashboardConfig('autorole.rules', 'access', 'Autorole rules', true)],
        eventHandlers: [eventHandler('autorole.events', ['member.joined'], true)],
    },
    {
        id: 'reaction_roles',
        label: 'Reaction roles',
        kinds: ['dashboard-config', 'event-handler'],
        dashboardConfigs: [dashboardConfig('reaction_roles.settings', 'access', 'Reaction roles settings', true)],
        eventHandlers: [eventHandler('reaction_roles.events', ['reaction.added', 'reaction.removed'], true)],
    },
    {
        id: 'verification',
        label: 'Verification',
        kinds: ['dashboard-config', 'event-handler'],
        dashboardConfigs: [dashboardConfig('verification.flows', 'access', 'Verification flows', true)],
        eventHandlers: [eventHandler('verification.events', ['member.joined', 'reaction.added'], true)],
    },
    {
        id: 'tickets',
        label: 'Tickets',
        kinds: ['dashboard-config', 'bot-managed-panel', 'event-handler'],
        dashboardConfigs: [dashboardConfig('tickets.panels', 'community', 'Ticket panels', true)],
        botManagedPanels: [
            {
                id: 'tickets.open_panel',
                dashboardCategoryId: 'community',
                label: 'Ticket open panel',
                implemented: true,
                controlMode: 'reaction',
                controlNames: ['open'],
            },
        ],
        eventHandlers: [eventHandler('tickets.events', ['reaction.added', 'channel.deleted'], true)],
    },
    {
        id: 'suggestions',
        label: 'Suggestions',
        kinds: ['dashboard-config', 'bot-command', 'event-handler'],
        dashboardConfigs: [dashboardConfig('suggestions.workflow', 'community', 'Suggestion workflow', true)],
        botCommands: liveCommands.filter((command) => command.categoryId === 'suggestions'),
        eventHandlers: [
            eventHandler('suggestions.events', ['message.created', 'reaction.added', 'reaction.removed'], true),
        ],
    },
    {
        id: 'posting',
        label: 'Dashboard posting',
        kinds: ['dashboard-config'],
        dashboardConfigs: [dashboardConfig('posting.dashboard_sender', 'messaging', 'Dashboard message sender', true)],
    },
    {
        id: 'profile_builder',
        label: 'Profile builder',
        kinds: ['dashboard-config'],
        dashboardConfigs: [dashboardConfig('profile_builder.forms', 'community', 'Profile forms', true)],
    },
    {
        id: 'giveaways',
        label: 'Giveaways',
        kinds: ['dashboard-config', 'event-handler'],
        dashboardConfigs: [dashboardConfig('giveaways.campaigns', 'community', 'Giveaways', true)],
        eventHandlers: [eventHandler('giveaways.entries', ['reaction.added', 'reaction.removed'], true)],
    },
    {
        id: 'xp',
        label: 'XP and levels',
        kinds: ['dashboard-config', 'bot-command', 'event-handler'],
        dashboardConfigs: [dashboardConfig('xp.rules', 'community', 'XP rules', true)],
        botCommands: liveCommands.filter((command) => command.categoryId === 'xp'),
        eventHandlers: [eventHandler('xp.activity', ['message.created', 'voice_state.updated'], true)],
    },
    {
        id: 'vc_generator',
        label: 'VC generator',
        kinds: ['dashboard-config', 'bot-managed-panel', 'event-handler'],
        dashboardConfigs: [dashboardConfig('vc_generator.panel', 'community', 'Generator panel', true)],
        botManagedPanels: [
            {
                id: 'vc_generator.control_panel',
                dashboardCategoryId: 'community',
                label: 'Voice channel control panel',
                implemented: true,
                controlMode: 'reaction',
                controlNames: ['rename', 'user_limit', 'whitelist', 'blacklist', 'lock', 'unlock'],
            },
        ],
        eventHandlers: [
            eventHandler(
                'vc_generator.events',
                ['message.created', 'voice_state.updated', 'channel.deleted', 'reaction.added'],
                true
            ),
        ],
    },
    {
        id: 'role_reconciliation',
        label: 'Role reconciliation',
        kinds: ['dashboard-config', 'event-handler'],
        dashboardConfigs: [
            dashboardConfig('role_reconciliation.settings', 'access', 'Role reconciliation settings', true),
        ],
        eventHandlers: [
            eventHandler('role_reconciliation.member_repair', ['member.updated'], true),
            eventHandler('role_reconciliation.structure_cleanup', ['role.deleted'], true),
        ],
    },
    {
        id: 'import_export',
        label: 'Import and export',
        kinds: ['dashboard-config', 'event-handler'],
        dashboardConfigs: [dashboardConfig('import_export.dry_run', 'structure', 'Structure export and dry-run', true)],
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

function guardedCommand(input: {
    id: string;
    commandName: string;
    usage: (prefix: string) => string;
    description: string;
}): BotCommandDefinition {
    return {
        id: input.id,
        categoryId: 'moderation',
        categoryTitle: BOT_COMMAND_CATEGORY_TITLES.moderation,
        commandName: input.commandName,
        usage: input.usage,
        description: input.description,
        defconCategory: DEFCON_FEATURE_CATEGORY.moderation,
        audience: 'guarded',
        visibleInHelp: true,
        implemented: true,
        grantable: true,
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
