import { loadWebConfig } from '@neonflux/config';
import {
    findDeploymentConfig,
    listGuildDashboardPermissionRulesByGuildIds,
    listGuildSecurityPoliciesByGuildIds,
    listBotInstallationGuildIds,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { listFluxerCurrentUserGuilds } from '@neonflux/fluxer/guilds';
import type * as NeonFluxerGuilds from '@neonflux/fluxer/guilds';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildAccess } from './dashboard-guild-access.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';
import type { AuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const request = new Request('http://localhost:3000/dashboard');
const authContext = {
    session: {
        id: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG',
        fluxerUserId: '1517169145576165376',
        createdAt: new Date('2026-06-21T00:00:00.000Z'),
        expiresAt: new Date('2026-06-28T00:00:00.000Z'),
        revokedAt: null,
    },
    fluxerUserId: '1517169145576165376',
    accessToken: 'fresh-access-token',
    scopes: ['identify', 'guilds'],
    accessTokenExpiresAt: new Date('2026-06-21T01:00:00.000Z'),
} satisfies AuthenticatedFluxerContext;

vi.mock('./database.server.js', () => ({
    getWebDatabaseClient: () => ({
        db: {},
    }),
}));

vi.mock('./fluxer-auth-context.server.js', () => ({
    readAuthenticatedFluxerContext: vi.fn(),
}));

vi.mock('@neonflux/config', () => ({
    loadWebConfig: vi.fn(),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        findDeploymentConfig: vi.fn(),
        listGuildDashboardPermissionRulesByGuildIds: vi.fn(),
        listGuildSecurityPoliciesByGuildIds: vi.fn(),
        listBotInstallationGuildIds: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/guilds', async (importActual) => {
    const actual = await importActual<typeof NeonFluxerGuilds>();

    return {
        ...actual,
        listFluxerCurrentUserGuilds: vi.fn(),
    };
});

describe('loadDashboardGuildAccess', () => {
    beforeEach(() => {
        vi.mocked(readAuthenticatedFluxerContext).mockResolvedValue(ok(authContext));
        vi.mocked(loadWebConfig).mockReturnValue({
            appEnv: 'production',
            databaseUrl: 'postgres://postgres:postgres@localhost:5432/neonflux_test',
            autoMigrate: true,
            guildDefconOverride: 'auto',
            logLevel: 'info',
            nodeEnv: 'test',
        });
        vi.mocked(findDeploymentConfig).mockResolvedValue(
            ok({
                instanceMode: 'multi',
                publicWebUrl: null,
                ownerIds: [],
            })
        );
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValue(
            ok([
                createFluxerGuild({ id: 'installed', name: 'Installed', permissions: '32' }),
                createFluxerGuild({ id: 'readonly', name: 'Readonly', permissions: '0' }),
            ])
        );
        vi.mocked(listGuildSecurityPoliciesByGuildIds).mockResolvedValue(ok([]));
        vi.mocked(listGuildDashboardPermissionRulesByGuildIds).mockResolvedValue(ok([]));
        vi.mocked(listBotInstallationGuildIds).mockResolvedValue(ok(['installed']));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('passes through auth context errors and does not call Fluxer guild lookup', async () => {
        vi.mocked(readAuthenticatedFluxerContext).mockResolvedValueOnce(err('missing-cookie'));

        const result = await loadDashboardGuildAccess(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-cookie');
        expect(listFluxerCurrentUserGuilds).not.toHaveBeenCalled();
        expect(listBotInstallationGuildIds).not.toHaveBeenCalled();
    });

    it('uses the refreshed access token from the authenticated Fluxer context', async () => {
        await loadDashboardGuildAccess(request);

        expect(findDeploymentConfig).toHaveBeenCalled();
        expect(listFluxerCurrentUserGuilds).toHaveBeenCalledWith({
            accessToken: authContext.accessToken,
            limit: 200,
        });
    });

    it('checks only the configured guild from deployment config in single mode', async () => {
        stubSingleModeDeploymentConfig('target');
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValueOnce(
            ok([
                createFluxerGuild({ id: 'target', name: 'Target', permissions: '32' }),
                createFluxerGuild({ id: 'other', name: 'Other', permissions: '32' }),
            ])
        );

        const result = await loadDashboardGuildAccess(request);

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            type: 'authorized',
            mode: {
                instanceMode: 'single',
                singleGuildId: 'target',
            },
            guilds: [
                {
                    id: 'target',
                    name: 'Target',
                    canManage: true,
                    botInstalled: false,
                },
            ],
        });
        expect(listBotInstallationGuildIds).not.toHaveBeenCalled();
    });

    it('returns unauthorized in single mode when the configured guild is not manageable', async () => {
        stubSingleModeDeploymentConfig('target');
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValueOnce(
            ok([createFluxerGuild({ id: 'target', name: 'Target', permissions: '0' })])
        );

        const result = await loadDashboardGuildAccess(request);

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            type: 'unauthorized',
            mode: {
                instanceMode: 'single',
                singleGuildId: 'target',
            },
            configuredGuildId: 'target',
            configuredGuildName: 'Target',
        });
        expect(listBotInstallationGuildIds).not.toHaveBeenCalled();
    });

    it('authorizes single-mode dashboard access for the server owner without Manage Server', async () => {
        stubSingleModeDeploymentConfig('target');
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValueOnce(
            ok([
                createFluxerGuild({
                    id: 'target',
                    name: 'Target',
                    permissions: '0',
                    ownerId: authContext.fluxerUserId,
                }),
            ])
        );

        const result = await loadDashboardGuildAccess(request);

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            type: 'authorized',
            mode: {
                instanceMode: 'single',
                singleGuildId: 'target',
            },
            guilds: [
                {
                    id: 'target',
                    name: 'Target',
                    ownerId: authContext.fluxerUserId,
                    canManage: false,
                    botInstalled: false,
                },
            ],
        });
    });

    it('returns unauthorized in single mode when the configured guild is missing from OAuth guilds', async () => {
        stubSingleModeDeploymentConfig('target');
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValueOnce(
            ok([createFluxerGuild({ id: 'other', name: 'Other', permissions: '32' })])
        );

        const result = await loadDashboardGuildAccess(request);

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            type: 'unauthorized',
            mode: {
                instanceMode: 'single',
                singleGuildId: 'target',
            },
            configuredGuildId: 'target',
        });
        expect(listBotInstallationGuildIds).not.toHaveBeenCalled();
    });

    it('returns only manageable installed guilds in multi mode', async () => {
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValueOnce(
            ok([
                createFluxerGuild({ id: 'installed', name: 'Installed', permissions: '32' }),
                createFluxerGuild({ id: 'readonly', name: 'Readonly', permissions: '0' }),
                createFluxerGuild({ id: 'not-installed', name: 'Not Installed', permissions: '32' }),
            ])
        );
        vi.mocked(listBotInstallationGuildIds).mockResolvedValueOnce(ok(['installed', 'readonly']));

        const result = await loadDashboardGuildAccess(request);

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            type: 'authorized',
            mode: {
                instanceMode: 'multi',
            },
            guilds: [
                {
                    id: 'installed',
                    name: 'Installed',
                    canManage: true,
                    botInstalled: true,
                },
            ],
        });
    });

    it('uses dashboard grants separately from Manage Server in DEFCON 3', async () => {
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValueOnce(
            ok([createFluxerGuild({ id: 'installed', name: 'Installed', permissions: '0' })])
        );
        vi.mocked(listGuildDashboardPermissionRulesByGuildIds).mockResolvedValueOnce(
            ok([
                {
                    guildId: 'installed',
                    userIds: [authContext.fluxerUserId],
                    roleIds: [],
                    createdAt: new Date('2026-06-23T00:00:00.000Z'),
                    updatedAt: new Date('2026-06-23T00:00:00.000Z'),
                },
            ])
        );

        const result = await loadDashboardGuildAccess(request);

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            type: 'authorized',
            mode: {
                instanceMode: 'multi',
            },
            guilds: [
                {
                    id: 'installed',
                    name: 'Installed',
                    canManage: false,
                    botInstalled: true,
                },
            ],
        });
    });

    it('blocks non-owner dashboard access in DEFCON 2', async () => {
        vi.mocked(listGuildSecurityPoliciesByGuildIds).mockResolvedValueOnce(
            ok([
                {
                    guildId: 'installed',
                    defconLevel: 2,
                    createdAt: new Date('2026-06-23T00:00:00.000Z'),
                    updatedAt: new Date('2026-06-23T00:00:00.000Z'),
                },
            ])
        );

        const result = await loadDashboardGuildAccess(request);

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            type: 'no-manageable-guilds',
            mode: {
                instanceMode: 'multi',
            },
        });
    });

    it('returns no-manageable-guilds in multi mode when no guilds are manageable and installed', async () => {
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValueOnce(
            ok([
                createFluxerGuild({ id: 'readonly', name: 'Readonly', permissions: '0' }),
                createFluxerGuild({ id: 'not-installed', name: 'Not Installed', permissions: '32' }),
            ])
        );
        vi.mocked(listBotInstallationGuildIds).mockResolvedValueOnce(ok(['readonly']));

        const result = await loadDashboardGuildAccess(request);

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            type: 'no-manageable-guilds',
            mode: {
                instanceMode: 'multi',
            },
        });
    });

    it('returns guild-lookup-failed when Fluxer guild lookup fails', async () => {
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValueOnce(
            err({ type: 'request-failed', status: 502, statusText: 'Bad Gateway' })
        );

        const result = await loadDashboardGuildAccess(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('guild-lookup-failed');
        expect(listBotInstallationGuildIds).not.toHaveBeenCalled();
    });

    it('returns deployment-config-not-found when bot bootstrap has not initialized config', async () => {
        vi.mocked(findDeploymentConfig).mockResolvedValueOnce(err('not-found'));

        const result = await loadDashboardGuildAccess(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('deployment-config-not-found');
        expect(listFluxerCurrentUserGuilds).not.toHaveBeenCalled();
    });

    it('returns database-error when deployment config lookup fails', async () => {
        vi.mocked(findDeploymentConfig).mockResolvedValueOnce(err('database-error'));

        const result = await loadDashboardGuildAccess(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
        expect(listFluxerCurrentUserGuilds).not.toHaveBeenCalled();
    });

    it('returns database-error when installed guild lookup fails in multi mode', async () => {
        vi.mocked(listBotInstallationGuildIds).mockResolvedValueOnce(err('database-error'));

        const result = await loadDashboardGuildAccess(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });

    it('returns database-error when dashboard policy lookup fails', async () => {
        vi.mocked(listGuildSecurityPoliciesByGuildIds).mockResolvedValueOnce(err('database-error'));

        const result = await loadDashboardGuildAccess(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });
});

function createFluxerGuild(input: { id: string; name: string; permissions: string; ownerId?: string }) {
    return input;
}

function stubSingleModeDeploymentConfig(singleGuildId: string): void {
    vi.mocked(findDeploymentConfig).mockResolvedValueOnce(
        ok({
            instanceMode: 'single',
            singleGuildId,
            publicWebUrl: null,
            ownerIds: [],
        })
    );
}
