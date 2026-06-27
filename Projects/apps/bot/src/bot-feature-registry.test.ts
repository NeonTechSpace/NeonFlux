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
        expect(visibleUsages).not.toContain('!ticket');
        expect(visibleUsages).not.toContain('!export');
        expect(visibleUsages).toContain('!warn <user> [reason]');
        expect(visibleUsages).toContain('!ban <user> [reason]');
        expect(visibleUsages).toContain('!timeout <user> <duration: 1m-28d> [reason]');
        expect(visibleUsages).toContain('!untimeout <user> [reason]');
        expect(visibleUsages).toContain('!purge <1-100> [reason]');
        expect(visibleUsages).toContain('!suggest <idea>');
        expect(visibleUsages).toContain('!rank [user]');
        expect(visibleUsages).toContain('!leaderboard');
    });

    it('keeps planned feature command metadata hidden until implemented', () => {
        const plannedCommands = listBotCommandMetadata().filter((command) => !command.implemented);

        expect(plannedCommands.map((command) => command.id)).toEqual([]);
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
            'automod',
            'logging',
            'autorole',
            'reaction_roles',
            'verification',
            'tickets',
            'suggestions',
            'giveaways',
            'posting',
            'profile_builder',
            'xp',
            'vc_generator',
            'role_reconciliation',
            'import_export',
        ]);
        expect(BOT_FEATURE_MODULES.find((featureModule) => featureModule.id === 'tickets')?.eventTypes).toStrictEqual([
            'reaction.added',
            'channel.deleted',
        ]);
        expect(BOT_FEATURE_MODULES.find((featureModule) => featureModule.id === 'automod')?.eventTypes).toStrictEqual([
            'message.created',
        ]);
        expect(BOT_FEATURE_MODULES.find((featureModule) => featureModule.id === 'giveaways')?.eventTypes).toStrictEqual(
            ['reaction.added', 'reaction.removed']
        );
        expect(BOT_FEATURE_MODULES.find((featureModule) => featureModule.id === 'posting')?.eventTypes).toStrictEqual(
            []
        );
        expect(
            BOT_FEATURE_MODULES.find((featureModule) => featureModule.id === 'profile_builder')?.eventTypes
        ).toStrictEqual([]);
        expect(
            BOT_FEATURE_MODULES.find((featureModule) => featureModule.id === 'vc_generator')?.eventTypes
        ).toStrictEqual(['message.created', 'voice_state.updated', 'channel.deleted', 'reaction.added']);
        expect(
            BOT_FEATURE_MODULES.find((featureModule) => featureModule.id === 'role_reconciliation')?.eventTypes
        ).toStrictEqual(['member.updated', 'role.deleted']);
        expect(
            BOT_FEATURE_MODULES.find((featureModule) => featureModule.id === 'import_export')?.eventTypes
        ).toStrictEqual([
            'guild.lifecycle.updated',
            'role.created',
            'role.updated',
            'role.deleted',
            'channel.created',
            'channel.updated',
            'channel.deleted',
        ]);
    });
});
