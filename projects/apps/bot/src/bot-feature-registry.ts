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
    {
        id: 'moderation',
        order: 100,
        commands: commandsByCategory('moderation'),
        eventTypes: ['message.created', 'ban.added', 'ban.removed'],
    },
    {
        id: 'automod',
        order: 105,
        commands: [],
        eventTypes: ['message.created'],
    },
    {
        id: 'logging',
        order: 110,
        commands: [],
        eventTypes: [
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
    },
    {
        id: 'autorole',
        order: 120,
        commands: [],
        eventTypes: ['member.joined'],
    },
    {
        id: 'reaction_roles',
        order: 130,
        commands: [],
        eventTypes: ['reaction.added', 'reaction.removed'],
    },
    {
        id: 'verification',
        order: 140,
        commands: [],
        eventTypes: ['member.joined', 'reaction.added'],
    },
    {
        id: 'tickets',
        order: 150,
        commands: [],
        eventTypes: ['reaction.added', 'channel.deleted'],
    },
    {
        id: 'suggestions',
        order: 160,
        commands: commandsByCategory('suggestions'),
        eventTypes: ['message.created', 'reaction.added', 'reaction.removed'],
    },
    {
        id: 'giveaways',
        order: 165,
        commands: [],
        eventTypes: ['reaction.added', 'reaction.removed'],
    },
    plannedModule('posting', 170, [], []),
    plannedModule('profile_builder', 180, [], []),
    {
        id: 'xp',
        order: 190,
        commands: commandsByCategory('xp'),
        eventTypes: ['message.created', 'voice_state.updated'],
    },
    {
        id: 'vc_generator',
        order: 200,
        commands: [],
        eventTypes: ['message.created', 'voice_state.updated', 'channel.deleted', 'reaction.added'],
    },
    {
        id: 'role_reconciliation',
        order: 210,
        commands: [],
        eventTypes: ['member.updated', 'role.deleted'],
    },
    {
        id: 'import_export',
        order: 220,
        commands: [],
        eventTypes: [
            'guild.lifecycle.updated',
            'role.created',
            'role.updated',
            'role.deleted',
            'channel.created',
            'channel.updated',
            'channel.deleted',
        ],
    },
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
