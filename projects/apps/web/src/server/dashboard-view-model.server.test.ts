import { describe, expect, it } from 'vitest';

import { toDashboardViewModel } from './dashboard-view-model.server.js';

describe('toDashboardViewModel', () => {
    it('maps authorized single-mode guild access to a guild list', () => {
        expect(
            toDashboardViewModel({
                type: 'authorized',
                mode: {
                    instanceMode: 'single',
                    singleGuildId: 'guild-1',
                },
                guilds: [
                    {
                        id: 'guild-1',
                        name: 'Guild One',
                        iconUrl: 'https://fluxerusercontent.com/avatars/guild-1/icon.webp?size=80',
                        canManage: true,
                        botInstalled: false,
                    },
                ],
            })
        ).toStrictEqual({
            type: 'guild-list',
            mode: 'single',
            guilds: [
                {
                    id: 'guild-1',
                    name: 'Guild One',
                    iconUrl: 'https://fluxerusercontent.com/avatars/guild-1/icon.webp?size=80',
                },
            ],
        });
    });

    it('maps authorized multi-mode guild access to a guild list', () => {
        expect(
            toDashboardViewModel({
                type: 'authorized',
                mode: {
                    instanceMode: 'multi',
                },
                guilds: [
                    {
                        id: 'guild-1',
                        name: 'Guild One',
                        canManage: true,
                        botInstalled: true,
                    },
                    {
                        id: 'guild-2',
                        name: 'Guild Two',
                        canManage: true,
                        botInstalled: true,
                    },
                ],
            })
        ).toStrictEqual({
            type: 'guild-list',
            mode: 'multi',
            guilds: [
                {
                    id: 'guild-1',
                    name: 'Guild One',
                },
                {
                    id: 'guild-2',
                    name: 'Guild Two',
                },
            ],
        });
    });

    it('falls back to guild id when an authorized guild has no name', () => {
        expect(
            toDashboardViewModel({
                type: 'authorized',
                mode: {
                    instanceMode: 'multi',
                },
                guilds: [
                    {
                        id: 'guild-1',
                        canManage: true,
                        botInstalled: true,
                    },
                ],
            })
        ).toStrictEqual({
            type: 'guild-list',
            mode: 'multi',
            guilds: [
                {
                    id: 'guild-1',
                    name: 'guild-1',
                },
            ],
        });
    });

    it('maps single-mode unauthorized access with configured guild name', () => {
        expect(
            toDashboardViewModel({
                type: 'unauthorized',
                mode: {
                    instanceMode: 'single',
                    singleGuildId: 'guild-1',
                },
                configuredGuildId: 'guild-1',
                configuredGuildName: 'Configured Community',
            })
        ).toStrictEqual({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Configured Community',
        });
    });

    it('falls back to configured guild id for unnamed single-mode unauthorized access', () => {
        expect(
            toDashboardViewModel({
                type: 'unauthorized',
                mode: {
                    instanceMode: 'single',
                    singleGuildId: 'guild-1',
                },
                configuredGuildId: 'guild-1',
            })
        ).toStrictEqual({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'guild-1',
        });
    });

    it('maps multi-mode empty access', () => {
        expect(
            toDashboardViewModel({
                type: 'no-manageable-guilds',
                mode: {
                    instanceMode: 'multi',
                },
            })
        ).toStrictEqual({
            type: 'multi-empty',
        });
    });
});
