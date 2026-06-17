import { describe, expect, it } from 'vitest';

import { selectDashboardGuilds, shouldHandleGuildEvent } from './mode.js';

describe('shouldHandleGuildEvent', () => {
    it('ignores non-target guild events in single mode', () => {
        expect(
            shouldHandleGuildEvent(
                {
                    instanceMode: 'single',
                    singleGuildId: 'target',
                },
                {
                    guildId: 'other',
                }
            )
        ).toBe(false);
    });

    it('accepts target guild events in single mode', () => {
        expect(
            shouldHandleGuildEvent(
                {
                    instanceMode: 'single',
                    singleGuildId: 'target',
                },
                {
                    guildId: 'target',
                }
            )
        ).toBe(true);
    });

    it('accepts installed guild events in multi mode', () => {
        expect(
            shouldHandleGuildEvent(
                {
                    instanceMode: 'multi',
                },
                {
                    guildId: 'installed',
                    installedGuildIds: ['installed'],
                }
            )
        ).toBe(true);
    });

    it('ignores non-installed guild events in multi mode when an installed set is supplied', () => {
        expect(
            shouldHandleGuildEvent(
                {
                    instanceMode: 'multi',
                },
                {
                    guildId: 'missing',
                    installedGuildIds: ['installed'],
                }
            )
        ).toBe(false);
    });
});

describe('selectDashboardGuilds', () => {
    const guilds = [
        {
            id: 'target',
            canManage: true,
            botInstalled: true,
        },
        {
            id: 'other',
            canManage: true,
            botInstalled: true,
        },
        {
            id: 'readonly',
            canManage: false,
            botInstalled: true,
        },
        {
            id: 'not-installed',
            canManage: true,
            botInstalled: false,
        },
    ];

    it('checks only SINGLE_GUILD_ID in single mode', () => {
        expect(
            selectDashboardGuilds(
                {
                    instanceMode: 'single',
                    singleGuildId: 'target',
                },
                guilds
            )
        ).toEqual([
            {
                id: 'target',
                canManage: true,
                botInstalled: true,
            },
        ]);
    });

    it('returns only manageable installed guilds in multi mode', () => {
        expect(
            selectDashboardGuilds(
                {
                    instanceMode: 'multi',
                },
                guilds
            )
        ).toEqual([
            {
                id: 'target',
                canManage: true,
                botInstalled: true,
            },
            {
                id: 'other',
                canManage: true,
                botInstalled: true,
            },
        ]);
    });
});
