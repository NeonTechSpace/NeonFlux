import { describe, expect, it } from 'vitest';

import {
    FEATURE_SURFACES,
    listGrantableBotCommandDefinitions,
    listImplementedBotCommandDefinitions,
} from './feature-catalog.js';

const expectedImplementedSurfaceIds = [
    'overview',
    'general',
    'settings',
    'posting',
    'audit',
    'reaction_roles',
    'import_export',
];

describe('feature catalog', () => {
    it('keeps only the approved executable feature surfaces implemented', () => {
        const implementedSurfaceIds = FEATURE_SURFACES.filter((surface) =>
            [
                ...(surface.dashboardConfigs ?? []),
                ...(surface.botCommands ?? []),
                ...(surface.botManagedPanels ?? []),
                ...(surface.eventHandlers ?? []),
            ].some((surfacePart) => surfacePart.implemented)
        ).map((surface) => surface.id);

        expect(implementedSurfaceIds).toStrictEqual(expectedImplementedSurfaceIds);
    });

    it('exposes only help, ping, and prefix as implemented bot commands', () => {
        expect(listImplementedBotCommandDefinitions().map((command) => command.id)).toStrictEqual([
            'general.help',
            'general.ping',
            'settings.prefix',
        ]);
    });

    it('keeps prefix as the only grantable command', () => {
        expect(listGrantableBotCommandDefinitions().map((command) => command.id)).toStrictEqual(['settings.prefix']);
    });
});
