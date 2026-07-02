import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadWebConfig } from '@neonflux/config';
import type * as NeonFluxConfig from '@neonflux/config';
import { loadDashboardGuildAccess } from './dashboard-guild-access.server.js';
import type { DashboardGuildAccess, DashboardGuildAccessError } from './dashboard-guild-access.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1');

vi.mock('./dashboard-guild-access.server.js', () => ({
    loadDashboardGuildAccess: vi.fn(),
}));

vi.mock('@neonflux/config', async (importActual) => {
    const actual = await importActual<typeof NeonFluxConfig>();

    return {
        ...actual,
        loadWebConfig: vi.fn(),
    };
});

describe('loadDashboardGuildPageData', () => {
    beforeEach(() => {
        vi.mocked(loadWebConfig).mockReturnValue(createWebConfig());
        vi.mocked(loadDashboardGuildAccess).mockResolvedValue(ok(createAuthorizedGuildAccess()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads an accessible guild page', async () => {
        await expect(loadDashboardGuildPageData(request, 'guild-1')).resolves.toStrictEqual({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'guild-1',
                name: 'Guild One',
                iconUrl: 'https://fluxerusercontent.com/icons/guild-1/icon.webp?size=80',
            },
            manageableGuilds: [
                {
                    id: 'guild-1',
                    name: 'Guild One',
                    iconUrl: 'https://fluxerusercontent.com/icons/guild-1/icon.webp?size=80',
                },
                {
                    id: 'guild-2',
                    name: 'Guild Two',
                },
            ],
        });
    });

    it('includes the configured bot invite URL for authorized guild routes', async () => {
        vi.mocked(loadWebConfig).mockReturnValueOnce(
            createWebConfig({
                fluxerBotInviteUrl:
                    'https://web.canary.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8',
            })
        );

        await expect(loadDashboardGuildPageData(request, 'guild-1')).resolves.toMatchObject({
            type: 'guild',
            botInviteUrl:
                'https://web.canary.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8',
        });
    });

    it('falls back to guild id when the accessible guild has no name', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(
            ok({
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
        );

        await expect(loadDashboardGuildPageData(request, 'guild-1')).resolves.toStrictEqual({
            type: 'guild',
            mode: 'multi',
            guild: {
                id: 'guild-1',
                name: 'guild-1',
            },
            manageableGuilds: [
                {
                    id: 'guild-1',
                    name: 'guild-1',
                },
            ],
        });
    });

    it('returns not-found for a guild outside the manageable list', async () => {
        await expect(loadDashboardGuildPageData(request, 'guild-3')).resolves.toStrictEqual({
            type: 'not-found',
        });
    });

    it('returns not-found for a blank guild id', async () => {
        await expect(loadDashboardGuildPageData(request, '   ')).resolves.toStrictEqual({
            type: 'not-found',
        });
        expect(loadDashboardGuildAccess).not.toHaveBeenCalled();
    });

    it('returns single unauthorized for the configured single-instance guild', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(
            ok({
                type: 'unauthorized',
                mode: {
                    instanceMode: 'single',
                    singleGuildId: 'guild-1',
                },
                configuredGuildId: 'guild-1',
                configuredGuildName: 'Configured Community',
            })
        );

        await expect(loadDashboardGuildPageData(request, 'guild-1')).resolves.toStrictEqual({
            type: 'single-unauthorized',
            configuredGuildId: 'guild-1',
            configuredGuildName: 'Configured Community',
        });
    });

    it('returns not-found when single unauthorized targets another guild', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(
            ok({
                type: 'unauthorized',
                mode: {
                    instanceMode: 'single',
                    singleGuildId: 'guild-1',
                },
                configuredGuildId: 'guild-1',
                configuredGuildName: 'Configured Community',
            })
        );

        await expect(loadDashboardGuildPageData(request, 'guild-2')).resolves.toStrictEqual({
            type: 'not-found',
        });
    });

    it.each([
        'missing-cookie',
        'invalid-cookie',
        'invalid-signature',
        'not-found',
        'missing-token-set',
        'token-expired',
        'missing-refresh-token',
        'token-refresh-failed',
        'invalid-token-payload',
        'decrypt-failed',
    ] satisfies DashboardGuildAccessError[])('maps recoverable %s errors to auth-required', async (error) => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(err(error));

        await expect(loadDashboardGuildPageData(request, 'guild-1')).resolves.toStrictEqual({ type: 'auth-required' });
    });

    it('maps missing deployment config', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(err('deployment-config-not-found'));

        await expect(loadDashboardGuildPageData(request, 'guild-1')).resolves.toStrictEqual({
            type: 'deployment-config-not-found',
        });
    });

    it('maps database failures', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(err('database-error'));

        await expect(loadDashboardGuildPageData(request, 'guild-1')).resolves.toStrictEqual({ type: 'database-error' });
    });

    it('maps guild lookup failures', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(err('guild-lookup-failed'));

        await expect(loadDashboardGuildPageData(request, 'guild-1')).resolves.toStrictEqual({
            type: 'guild-lookup-failed',
        });
    });
});

function createAuthorizedGuildAccess(): DashboardGuildAccess {
    return {
        type: 'authorized',
        mode: {
            instanceMode: 'multi',
        },
        guilds: [
            {
                id: 'guild-1',
                name: 'Guild One',
                iconUrl: 'https://fluxerusercontent.com/icons/guild-1/icon.webp?size=80',
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
    };
}

function createWebConfig(overrides: Partial<ReturnType<typeof loadWebConfig>> = {}): ReturnType<typeof loadWebConfig> {
    return {
        appEnv: 'development',
        databaseUrl: 'postgres://postgres:postgres@localhost:5432/neonflux_test',
        autoMigrate: true,
        guildDefconOverride: 'auto',
        logLevel: 'info',
        nodeEnv: 'test',
        ...overrides,
    };
}
