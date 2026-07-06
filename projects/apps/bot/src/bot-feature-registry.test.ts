import { describe, expect, it } from 'vitest';

import { BOT_FEATURE_MODULES, getVisibleHelpCategories, listBotCommandMetadata } from './bot-feature-registry.js';

describe('bot feature registry', () => {
    it('registers only executable bot modules', () => {
        expect(BOT_FEATURE_MODULES.map((featureModule) => featureModule.id)).toStrictEqual([
            'general',
            'settings',
            'reaction_roles',
            'posting',
            'import_export',
        ]);
    });

    it('does not advertise removed command families in help', () => {
        const helpText = getVisibleHelpCategories('!')
            .flatMap((category) => category.commands.map((command) => command.usage))
            .join('\n');

        expect(helpText).toContain('!help [category]');
        expect(helpText).toContain('!ping');
        expect(helpText).toContain('@NeonFlux prefix ?');
        expect(helpText).not.toMatch(/warn|ban|suggest|rank|leaderboard/u);
    });

    it('keeps registry command metadata aligned to implemented commands', () => {
        expect(listBotCommandMetadata().map((command) => command.id)).toStrictEqual([
            'general.help',
            'general.ping',
            'settings.prefix',
        ]);
    });
});
