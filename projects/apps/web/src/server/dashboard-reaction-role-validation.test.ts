import { describe, expect, it } from 'vitest';

import type { FluxerReactionRoleCatalog } from '@neonflux/fluxer/reaction-roles';

import { validateDashboardReactionRolePanelInput } from './dashboard-reaction-role-validation.js';

const catalog: FluxerReactionRoleCatalog = {
    channels: [
        {
            eligible: true,
            id: 'channel-1',
            name: 'roles',
            parentId: null,
            parentName: null,
            position: 1,
        },
    ],
    emojis: [
        {
            animated: true,
            id: 'emoji-1',
            markup: '<a:canonical:emoji-1>',
            name: 'canonical',
            url: 'https://cdn.example.test/emoji-1.gif',
        },
    ],
    guildId: 'guild-1',
    guildName: 'Guild',
    roles: [{ color: 0, eligible: true, id: 'role-1', name: 'Canonical role' }],
};

describe('validateDashboardReactionRolePanelInput', () => {
    it('binds role and uploaded emoji metadata to the live server catalog', () => {
        const result = validateDashboardReactionRolePanelInput(
            {
                channelId: 'channel-1',
                name: 'Panel',
                payload: {
                    embeds: [],
                    mode: 'independent',
                    options: [
                        {
                            emoji: {
                                animated: false,
                                id: 'emoji-1',
                                kind: 'custom',
                                name: 'client-controlled',
                            },
                            id: 'option-1',
                            roleId: 'role-1',
                            roleName: 'Client controlled',
                        },
                    ],
                },
            },
            catalog
        );

        expect(result.type).toBe('valid');
        if (result.type !== 'valid') return;
        expect(result.payload.options[0]).toMatchObject({
            emoji: { animated: true, id: 'emoji-1', kind: 'custom', name: 'canonical' },
            roleName: 'Canonical role',
        });
    });

    it('rejects uploaded emoji that are not in the selected server', () => {
        const result = validateDashboardReactionRolePanelInput(
            {
                channelId: 'channel-1',
                name: 'Panel',
                payload: {
                    embeds: [],
                    mode: 'independent',
                    options: [
                        {
                            emoji: { animated: false, id: 'other-emoji', kind: 'custom', name: 'other' },
                            id: 'option-1',
                            roleId: 'role-1',
                            roleName: 'Role',
                        },
                    ],
                },
            },
            catalog
        );

        expect(result).toEqual({
            message: 'One or more server emoji are no longer available.',
            type: 'invalid-panel',
        });
    });
});
