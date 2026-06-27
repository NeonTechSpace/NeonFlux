import { describe, expect, it } from 'vitest';

import {
    FEATURE_SURFACES,
    findBotCommandDefinition,
    listBotCommandDefinitions,
    listGrantableBotCommandCategories,
    listGrantableBotCommandDefinitions,
} from './feature-catalog.js';

describe('feature catalog', () => {
    it('keeps implemented grantable commands limited to real guarded bot commands', () => {
        expect(listGrantableBotCommandDefinitions().map((command) => command.id)).toStrictEqual([
            'settings.prefix',
            'moderation.warn',
            'moderation.warnings',
            'moderation.warning.delete',
            'moderation.warnings.clear',
            'moderation.case',
            'moderation.cases',
            'moderation.reason',
            'moderation.note',
            'moderation.notes',
        ]);
        expect(listGrantableBotCommandCategories()).toStrictEqual([
            {
                id: 'settings',
                title: 'Settings',
            },
            {
                id: 'moderation',
                title: 'Moderation',
            },
        ]);
    });

    it('classifies dashboard-only configuration without fake bot command placeholders', () => {
        const commandIds = listBotCommandDefinitions().map((command) => command.id);

        expect(commandIds).toContain('general.help');
        expect(commandIds).toContain('settings.prefix');
        expect(commandIds).not.toContain('logging.configure');
        expect(commandIds).not.toContain('posting.send');
        expect(commandIds).not.toContain('vc.configure');
        expect(getFeatureKinds('logging')).toStrictEqual(['dashboard-config', 'event-handler']);
        expect(getFeatureKinds('posting')).toStrictEqual(['dashboard-config']);
    });

    it('tracks roadmap choices for XP voice activity and VC reaction panels', () => {
        const xpSurface = getFeatureSurface('xp');
        const vcSurface = getFeatureSurface('vc_generator');

        expect(xpSurface.eventHandlers?.[0]?.eventTypes).toContain('voice_state.updated');
        expect(vcSurface.botManagedPanels).toStrictEqual([
            {
                id: 'vc_generator.control_panel',
                dashboardCategoryId: 'community',
                label: 'Voice channel control panel',
                implemented: false,
                controlMode: 'reaction',
                controlNames: ['rename', 'user_limit', 'whitelist', 'blacklist', 'lock', 'unlock'],
            },
        ]);
    });

    it('keeps public help discoverable but not grantable', () => {
        expect(findBotCommandDefinition('general.help')).toMatchObject({
            audience: 'public',
            visibleInHelp: true,
            implemented: true,
            grantable: false,
        });
    });
});

function getFeatureKinds(featureId: string) {
    return getFeatureSurface(featureId).kinds;
}

function getFeatureSurface(featureId: string) {
    const surface = FEATURE_SURFACES.find((candidate) => candidate.id === featureId);

    if (!surface) {
        throw new Error(`Missing feature surface: ${featureId}`);
    }

    return surface;
}
