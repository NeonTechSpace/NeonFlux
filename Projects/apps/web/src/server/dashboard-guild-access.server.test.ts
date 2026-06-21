import { listBotInstallationGuildIds } from '@neonflux/db';
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

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
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
        stubMultiModeEnv();
        vi.mocked(readAuthenticatedFluxerContext).mockResolvedValue(ok(authContext));
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValue(
            ok([
                createFluxerGuild({ id: 'installed', name: 'Installed', permissions: '32' }),
                createFluxerGuild({ id: 'readonly', name: 'Readonly', permissions: '0' }),
            ])
        );
        vi.mocked(listBotInstallationGuildIds).mockResolvedValue(ok(['installed']));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
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

        expect(listFluxerCurrentUserGuilds).toHaveBeenCalledWith({
            accessToken: authContext.accessToken,
            limit: 200,
        });
    });

    it('checks only SINGLE_GUILD_ID in single mode', async () => {
        stubSingleModeEnv('target');
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
        stubSingleModeEnv('target');
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

    it('returns unauthorized in single mode when the configured guild is missing from OAuth guilds', async () => {
        stubSingleModeEnv('target');
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

    it('returns database-error when installed guild lookup fails in multi mode', async () => {
        vi.mocked(listBotInstallationGuildIds).mockResolvedValueOnce(err('database-error'));

        const result = await loadDashboardGuildAccess(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });
});

function stubMultiModeEnv(): void {
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('INSTANCE_MODE', 'multi');
}

function stubSingleModeEnv(singleGuildId: string): void {
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('INSTANCE_MODE', 'single');
    vi.stubEnv('SINGLE_GUILD_ID', singleGuildId);
}

function createFluxerGuild(input: { id: string; name: string; permissions: string }) {
    return input;
}
