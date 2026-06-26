import { DEFCON_FEATURE_CATEGORY } from '@neonflux/core/defcon';

import type { BotCommandMetadata, BotFeatureModule, BotHelpCategory } from './bot-feature-module.js';

const liveCommands = [
    {
        id: 'help',
        categoryId: 'general',
        categoryTitle: 'General',
        usage: (prefix: string) => `${prefix}help [category]`,
        description: 'Show command help pages.',
        defconCategory: DEFCON_FEATURE_CATEGORY.help,
        audience: 'public',
        visibleInHelp: true,
        implemented: true,
    },
    {
        id: 'ping',
        categoryId: 'general',
        categoryTitle: 'General',
        usage: (prefix: string) => `${prefix}ping`,
        description: 'Check whether NeonFlux can reply in this channel.',
        defconCategory: DEFCON_FEATURE_CATEGORY.botMention,
        audience: 'public',
        visibleInHelp: true,
        implemented: true,
    },
    {
        id: 'prefix',
        categoryId: 'settings',
        categoryTitle: 'Settings',
        usage: () => '@NeonFlux prefix ?',
        description: 'Change the command prefix. Requires Manage Server or an allowed rule.',
        defconCategory: DEFCON_FEATURE_CATEGORY.prefix,
        audience: 'guarded',
        visibleInHelp: true,
        implemented: true,
    },
] as const satisfies readonly BotCommandMetadata[];

const plannedCommands = {
    moderation: plannedCommand('moderation.ban', 'moderation', 'Moderation', 'ban', DEFCON_FEATURE_CATEGORY.moderation),
    logging: plannedCommand('logging.configure', 'logging', 'Logging', 'logs', DEFCON_FEATURE_CATEGORY.logging),
    autorole: plannedCommand(
        'autorole.configure',
        'autorole',
        'Autorole',
        'autorole',
        DEFCON_FEATURE_CATEGORY.autorole
    ),
    reactionRoles: plannedCommand(
        'reaction_roles.configure',
        'reaction-roles',
        'Reaction Roles',
        'rr',
        DEFCON_FEATURE_CATEGORY.reactionRoles
    ),
    verification: plannedCommand(
        'verification.configure',
        'verification',
        'Verification',
        'verify',
        DEFCON_FEATURE_CATEGORY.verification
    ),
    tickets: plannedCommand('tickets.configure', 'tickets', 'Tickets', 'ticket', DEFCON_FEATURE_CATEGORY.tickets),
    suggestions: plannedCommand(
        'suggestions.create',
        'suggestions',
        'Suggestions',
        'suggest',
        DEFCON_FEATURE_CATEGORY.suggestions
    ),
    posting: plannedCommand('posting.send', 'posting', 'Posting', 'post', DEFCON_FEATURE_CATEGORY.posting),
    profile: plannedCommand(
        'profile.configure',
        'profile',
        'Profile Builder',
        'profile',
        DEFCON_FEATURE_CATEGORY.profileBuilder
    ),
    xp: plannedCommand('xp.rank', 'xp', 'XP', 'rank', DEFCON_FEATURE_CATEGORY.xp),
    vc: plannedCommand('vc.configure', 'vc', 'VC Generator', 'vc', DEFCON_FEATURE_CATEGORY.vcGenerator),
    roleReconciliation: plannedCommand(
        'roles.reconcile',
        'roles',
        'Role Reconciliation',
        'roles',
        DEFCON_FEATURE_CATEGORY.roleReconciliation
    ),
    importExport: plannedCommand(
        'structure.export',
        'structure',
        'Import / Export',
        'export',
        DEFCON_FEATURE_CATEGORY.importExport
    ),
} as const satisfies Record<string, BotCommandMetadata>;

export const BOT_FEATURE_MODULES = [
    {
        id: 'general',
        order: 10,
        commands: liveCommands.filter((command) => command.categoryId === 'general'),
        eventTypes: ['message.created'],
    },
    {
        id: 'settings',
        order: 20,
        commands: liveCommands.filter((command) => command.categoryId === 'settings'),
        eventTypes: ['message.created'],
    },
    plannedModule('moderation', 100, [plannedCommands.moderation], ['message.created', 'ban.added', 'ban.removed']),
    plannedModule(
        'logging',
        110,
        [plannedCommands.logging],
        [
            'guild.lifecycle.updated',
            'message.updated',
            'message.deleted',
            'reaction.added',
            'reaction.removed',
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
        ]
    ),
    plannedModule('autorole', 120, [plannedCommands.autorole], ['member.joined']),
    plannedModule('reaction_roles', 130, [plannedCommands.reactionRoles], ['reaction.added', 'reaction.removed']),
    plannedModule('verification', 140, [plannedCommands.verification], ['member.joined', 'reaction.added']),
    plannedModule('tickets', 150, [plannedCommands.tickets], ['message.created', 'channel.deleted']),
    plannedModule(
        'suggestions',
        160,
        [plannedCommands.suggestions],
        ['message.created', 'reaction.added', 'reaction.removed']
    ),
    plannedModule('posting', 170, [plannedCommands.posting], ['message.created']),
    plannedModule('profile_builder', 180, [plannedCommands.profile], ['message.created']),
    plannedModule('xp', 190, [plannedCommands.xp], ['message.created']),
    plannedModule('vc_generator', 200, [plannedCommands.vc], ['voice_state.updated', 'channel.deleted']),
    plannedModule(
        'role_reconciliation',
        210,
        [plannedCommands.roleReconciliation],
        ['member.updated', 'role.updated', 'role.deleted']
    ),
    plannedModule(
        'import_export',
        220,
        [plannedCommands.importExport],
        [
            'guild.lifecycle.updated',
            'role.created',
            'role.updated',
            'role.deleted',
            'channel.created',
            'channel.updated',
            'channel.deleted',
        ]
    ),
] as const satisfies readonly BotFeatureModule[];

export function listBotCommandMetadata(): BotCommandMetadata[] {
    return [...BOT_FEATURE_MODULES]
        .sort((left, right) => left.order - right.order)
        .flatMap((featureModule) => featureModule.commands);
}

export function getVisibleHelpCategories(prefix: string): BotHelpCategory[] {
    const categoryById = new Map<string, BotHelpCategory>();

    for (const command of listBotCommandMetadata()) {
        if (!command.visibleInHelp || !command.implemented) {
            continue;
        }

        const category = categoryById.get(command.categoryId) ?? {
            id: command.categoryId,
            title: command.categoryTitle,
            commands: [],
        };

        category.commands.push({
            usage: command.usage(prefix),
            description: command.description,
        });
        categoryById.set(command.categoryId, category);
    }

    return [...categoryById.values()];
}

function plannedCommand(
    id: string,
    categoryId: string,
    categoryTitle: string,
    commandName: string,
    defconCategory: BotCommandMetadata['defconCategory']
): BotCommandMetadata {
    return {
        id,
        categoryId,
        categoryTitle,
        usage: (prefix) => `${prefix}${commandName}`,
        description: 'Planned command scaffold.',
        defconCategory,
        audience: 'guarded',
        visibleInHelp: false,
        implemented: false,
    };
}

function plannedModule(
    id: string,
    order: number,
    commands: readonly BotCommandMetadata[],
    eventTypes: BotFeatureModule['eventTypes']
): BotFeatureModule {
    return {
        id,
        order,
        commands,
        eventTypes,
    };
}
