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
            'moderation.kick',
            'moderation.ban',
            'moderation.unban',
            'moderation.timeout',
            'moderation.untimeout',
            'moderation.purge',
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
        expect(commandIds).toContain('suggestions.suggest');
        expect(commandIds).not.toContain('logging.configure');
        expect(commandIds).not.toContain('posting.send');
        expect(commandIds).not.toContain('vc.configure');
        expect(getFeatureKinds('logging')).toStrictEqual(['dashboard-config', 'event-handler']);
        expect(getFeatureKinds('posting')).toStrictEqual(['dashboard-config']);
        expect(getFeatureKinds('profile_builder')).toStrictEqual(['dashboard-config']);
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
                implemented: true,
                controlMode: 'reaction',
                controlNames: ['rename', 'user_limit', 'whitelist', 'blacklist', 'lock', 'unlock'],
            },
        ]);
        expect(vcSurface.dashboardConfigs).toContainEqual({
            id: 'vc_generator.panel',
            dashboardCategoryId: 'community',
            label: 'Generator panel',
            implemented: true,
        });
        expect(vcSurface.eventHandlers).toContainEqual({
            id: 'vc_generator.events',
            eventTypes: ['message.created', 'voice_state.updated', 'channel.deleted', 'reaction.added'],
            implemented: true,
        });
    });

    it('keeps public help discoverable but not grantable', () => {
        expect(findBotCommandDefinition('general.help')).toMatchObject({
            audience: 'public',
            visibleInHelp: true,
            implemented: true,
            grantable: false,
        });
        expect(findBotCommandDefinition('xp.rank')).toMatchObject({
            audience: 'public',
            visibleInHelp: true,
            implemented: true,
            grantable: false,
        });
        expect(findBotCommandDefinition('suggestions.suggest')).toMatchObject({
            audience: 'public',
            visibleInHelp: true,
            implemented: true,
            grantable: false,
        });
    });

    it('marks moderation ban event reconciliation as implemented', () => {
        expect(getFeatureSurface('moderation').eventHandlers).toContainEqual({
            id: 'moderation.events',
            eventTypes: ['ban.added', 'ban.removed'],
            implemented: true,
        });
    });

    it('marks automod dashboard rules and record-only message handler as implemented', () => {
        const automodSurface = getFeatureSurface('automod');

        expect(automodSurface.dashboardConfigs).toContainEqual({
            id: 'automod.rules',
            dashboardCategoryId: 'moderation',
            label: 'Automod rules',
            implemented: true,
        });
        expect(automodSurface.eventHandlers).toContainEqual({
            id: 'automod.events',
            eventTypes: ['message.created'],
            implemented: true,
        });
        expect(listBotCommandDefinitions().map((command) => command.id)).not.toContain('automod.configure');
    });

    it('marks server event logging destinations and handlers as implemented', () => {
        const loggingSurface = getFeatureSurface('logging');

        expect(loggingSurface.dashboardConfigs).toContainEqual({
            id: 'logging.destinations',
            dashboardCategoryId: 'logging',
            label: 'Event log destinations',
            implemented: true,
        });
        expect(loggingSurface.eventHandlers?.[0]).toMatchObject({
            id: 'logging.events',
            implemented: true,
        });
        expect(loggingSurface.eventHandlers?.[0]?.eventTypes).toContain('message.deleted');
        expect(loggingSurface.eventHandlers?.[0]?.eventTypes).toContain('voice_state.updated');
    });

    it('marks autorole dashboard rules and join handler as implemented', () => {
        const autoroleSurface = getFeatureSurface('autorole');

        expect(autoroleSurface.dashboardConfigs).toContainEqual({
            id: 'autorole.rules',
            dashboardCategoryId: 'access',
            label: 'Autorole rules',
            implemented: true,
        });
        expect(autoroleSurface.eventHandlers).toContainEqual({
            id: 'autorole.events',
            eventTypes: ['member.joined'],
            implemented: true,
        });
    });

    it('marks role reconciliation settings, member repair, and deleted-role cleanup as implemented', () => {
        const roleReconciliationSurface = getFeatureSurface('role_reconciliation');

        expect(roleReconciliationSurface.dashboardConfigs).toContainEqual({
            id: 'role_reconciliation.settings',
            dashboardCategoryId: 'access',
            label: 'Role reconciliation settings',
            implemented: true,
        });
        expect(roleReconciliationSurface.eventHandlers).toContainEqual({
            id: 'role_reconciliation.member_repair',
            eventTypes: ['member.updated'],
            implemented: true,
        });
        expect(roleReconciliationSurface.eventHandlers).toContainEqual({
            id: 'role_reconciliation.structure_cleanup',
            eventTypes: ['role.deleted'],
            implemented: true,
        });
    });

    it('marks import/export dry-run dashboard tools and structure event observation as implemented', () => {
        const importExportSurface = getFeatureSurface('import_export');

        expect(importExportSurface.dashboardConfigs).toContainEqual({
            id: 'import_export.dry_run',
            dashboardCategoryId: 'structure',
            label: 'Structure export and dry-run',
            implemented: true,
        });
        expect(importExportSurface.eventHandlers).toContainEqual({
            id: 'import_export.events',
            eventTypes: [
                'guild.lifecycle.updated',
                'role.created',
                'role.updated',
                'role.deleted',
                'channel.created',
                'channel.updated',
                'channel.deleted',
            ],
            implemented: true,
        });
    });

    it('marks reaction-role dashboard settings and reaction handlers as implemented', () => {
        const reactionRoleSurface = getFeatureSurface('reaction_roles');

        expect(reactionRoleSurface.dashboardConfigs).toContainEqual({
            id: 'reaction_roles.settings',
            dashboardCategoryId: 'access',
            label: 'Reaction roles settings',
            implemented: true,
        });
        expect(reactionRoleSurface.eventHandlers).toContainEqual({
            id: 'reaction_roles.events',
            eventTypes: ['reaction.added', 'reaction.removed'],
            implemented: true,
        });
        expect(listBotCommandDefinitions().map((command) => command.id)).not.toContain('reaction_roles.configure');
    });

    it('marks verification dashboard flows and handlers as implemented', () => {
        const verificationSurface = getFeatureSurface('verification');

        expect(verificationSurface.dashboardConfigs).toContainEqual({
            id: 'verification.flows',
            dashboardCategoryId: 'access',
            label: 'Verification flows',
            implemented: true,
        });
        expect(verificationSurface.eventHandlers).toContainEqual({
            id: 'verification.events',
            eventTypes: ['member.joined', 'reaction.added'],
            implemented: true,
        });
        expect(listBotCommandDefinitions().map((command) => command.id)).not.toContain('verification.configure');
    });

    it('marks XP dashboard rules, commands, and activity handlers as implemented', () => {
        const xpSurface = getFeatureSurface('xp');

        expect(xpSurface.dashboardConfigs).toContainEqual({
            id: 'xp.rules',
            dashboardCategoryId: 'community',
            label: 'XP rules',
            implemented: true,
        });
        expect(xpSurface.botCommands?.map((command) => command.id)).toStrictEqual(['xp.rank', 'xp.leaderboard']);
        expect(xpSurface.eventHandlers).toContainEqual({
            id: 'xp.activity',
            eventTypes: ['message.created', 'voice_state.updated'],
            implemented: true,
        });
    });

    it('marks suggestions dashboard workflow, command, and vote handlers as implemented', () => {
        const suggestionsSurface = getFeatureSurface('suggestions');

        expect(suggestionsSurface.dashboardConfigs).toContainEqual({
            id: 'suggestions.workflow',
            dashboardCategoryId: 'community',
            label: 'Suggestion workflow',
            implemented: true,
        });
        expect(suggestionsSurface.botCommands?.map((command) => command.id)).toStrictEqual(['suggestions.suggest']);
        expect(suggestionsSurface.eventHandlers).toContainEqual({
            id: 'suggestions.events',
            eventTypes: ['message.created', 'reaction.added', 'reaction.removed'],
            implemented: true,
        });
    });

    it('marks tickets dashboard panels and reaction handlers as implemented without a chat command', () => {
        const ticketsSurface = getFeatureSurface('tickets');

        expect(ticketsSurface.dashboardConfigs).toContainEqual({
            id: 'tickets.panels',
            dashboardCategoryId: 'community',
            label: 'Ticket panels',
            implemented: true,
        });
        expect(ticketsSurface.botManagedPanels).toContainEqual({
            id: 'tickets.open_panel',
            dashboardCategoryId: 'community',
            label: 'Ticket open panel',
            implemented: true,
            controlMode: 'reaction',
            controlNames: ['open'],
        });
        expect(ticketsSurface.eventHandlers).toContainEqual({
            id: 'tickets.events',
            eventTypes: ['reaction.added', 'channel.deleted'],
            implemented: true,
        });
        expect(listBotCommandDefinitions().map((command) => command.id)).not.toContain('tickets.open');
    });

    it('marks profile builder forms as dashboard-only configuration', () => {
        const profileBuilderSurface = getFeatureSurface('profile_builder');

        expect(profileBuilderSurface.dashboardConfigs).toContainEqual({
            id: 'profile_builder.forms',
            dashboardCategoryId: 'community',
            label: 'Profile forms',
            implemented: true,
        });
        expect(profileBuilderSurface.eventHandlers).toBeUndefined();
        expect(listBotCommandDefinitions().map((command) => command.id)).not.toContain('profile_builder.submit');
    });

    it('marks giveaways as dashboard configuration with reaction-entry handling', () => {
        const giveawaysSurface = getFeatureSurface('giveaways');

        expect(giveawaysSurface.dashboardConfigs).toContainEqual({
            id: 'giveaways.campaigns',
            dashboardCategoryId: 'community',
            label: 'Giveaways',
            implemented: true,
        });
        expect(giveawaysSurface.eventHandlers).toContainEqual({
            id: 'giveaways.entries',
            eventTypes: ['reaction.added', 'reaction.removed'],
            implemented: true,
        });
        expect(listBotCommandDefinitions().map((command) => command.id)).not.toContain('giveaways.create');
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
