import { listBotCommandDefinitions } from '@neonflux/core';

import type { BotCommandMetadata, BotFeatureModule, BotHelpCategory } from './bot-feature-module.js';

const botCommands = listBotCommandDefinitions();

export const BOT_FEATURE_MODULES = [
    {
        id: 'general',
        order: 10,
        commands: commandsByCategory('general'),
        eventTypes: ['message.created'],
    },
    {
        id: 'settings',
        order: 20,
        commands: commandsByCategory('settings'),
        eventTypes: ['message.created'],
    },
    plannedModule('moderation', 100, commandsByCategory('moderation'), ['message.created', 'ban.added', 'ban.removed']),
    plannedModule(
        'logging',
        110,
        [],
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
    plannedModule('autorole', 120, [], ['member.joined']),
    plannedModule('reaction_roles', 130, [], ['reaction.added', 'reaction.removed']),
    plannedModule('verification', 140, [], ['member.joined', 'reaction.added']),
    plannedModule('tickets', 150, [], ['message.created', 'channel.deleted']),
    plannedModule('suggestions', 160, commandsByCategory('suggestions'), [
        'message.created',
        'reaction.added',
        'reaction.removed',
    ]),
    plannedModule('posting', 170, [], ['message.created']),
    plannedModule('profile_builder', 180, [], ['message.created']),
    plannedModule('xp', 190, commandsByCategory('xp'), ['message.created', 'voice_state.updated']),
    plannedModule('vc_generator', 200, [], ['voice_state.updated', 'channel.deleted']),
    plannedModule('role_reconciliation', 210, [], ['member.updated', 'role.updated', 'role.deleted']),
    plannedModule(
        'import_export',
        220,
        [],
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

function commandsByCategory(categoryId: string): BotCommandMetadata[] {
    return botCommands.filter((command) => command.categoryId === categoryId);
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
