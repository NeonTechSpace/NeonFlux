import { listBotCommandDefinitions } from '@neonflux/core';

import type { BotCommandMetadata, BotFeatureModule, BotHelpCategory } from './bot-feature-module.js';

const botCommands = listBotCommandDefinitions();

const BOT_FEATURE_MODULES = [
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
    plannedModule('posting', 170, [], []),
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

function listBotCommandMetadata(): BotCommandMetadata[] {
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
