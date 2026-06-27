import { describe, expect, it } from 'vitest';

import { BOT_FEATURE_MODULES, getVisibleHelpCategories, listBotCommandMetadata } from './bot-feature-registry.js';

describe('bot feature registry', () => {
    it('returns live command help without planned command placeholders', () => {
        const categories = getVisibleHelpCategories('!');
        const visibleUsages = categories.flatMap((category) => category.commands.map((command) => command.usage));
        const implementedVisibleUsages = listBotCommandMetadata()
            .filter((command) => command.implemented && command.visibleInHelp)
            .map((command) => command.usage('!'));

        expect(visibleUsages).toStrictEqual(implementedVisibleUsages);
        expect(visibleUsages).not.toContain('!ban');
        expect(visibleUsages).not.toContain('!ticket');
        expect(visibleUsages).not.toContain('!export');
    });

    it('keeps planned feature command metadata hidden until implemented', () => {
        const plannedCommands = listBotCommandMetadata().filter((command) => !command.implemented);

        expect(plannedCommands.map((command) => command.id)).toEqual([
            'moderation.kick',
            'moderation.ban',
            'moderation.unban',
            'moderation.timeout',
            'moderation.warn',
            'suggestions.suggest',
            'xp.rank',
            'xp.leaderboard',
        ]);
        expect(plannedCommands.every((command) => !command.visibleInHelp)).toBe(true);
        expect(listBotCommandMetadata().some((command) => command.id === 'logging.configure')).toBe(false);
        expect(listBotCommandMetadata().some((command) => command.id === 'vc.configure')).toBe(false);
        expect(listBotCommandMetadata().some((command) => command.id === 'posting.send')).toBe(false);
    });

    it('keeps feature module ordering explicit', () => {
        const orders = BOT_FEATURE_MODULES.map((featureModule) => featureModule.order);

        expect(orders).toStrictEqual([...orders].sort((left, right) => left - right));
        expect(BOT_FEATURE_MODULES.map((featureModule) => featureModule.id)).toStrictEqual([
            'general',
            'settings',
            'moderation',
            'logging',
            'autorole',
            'reaction_roles',
            'verification',
            'tickets',
            'suggestions',
            'posting',
            'profile_builder',
            'xp',
            'vc_generator',
            'role_reconciliation',
            'import_export',
        ]);
    });
});
