import { loadWebConfig } from '@neonflux/config';
import {
    listBotInstallationGuildIds,
    listGuildSecurityPoliciesByGuildIds,
    readDashboardGuildAuthorizationFacts,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { listFluxerCurrentUserGuilds } from '@neonflux/fluxer/guilds';
import type * as FluxerGuilds from '@neonflux/fluxer/guilds';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getWebDb } from './db.server.js';
import { authorizeDashboardPostingTarget } from './dashboard-posting-authorization.server.js';
import type { AuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const authContext = {
    accessToken: 'fresh-access-token',
    accessTokenExpiresAt: new Date('2026-07-16T12:00:00.000Z'),
    fluxerUserId: 'user-1',
    scopes: ['identify', 'guilds'],
    session: {
        createdAt: new Date('2026-07-16T10:00:00.000Z'),
        expiresAt: new Date('2026-07-17T10:00:00.000Z'),
        fluxerUserId: 'user-1',
        id: 'session-1',
        revokedAt: null,
    },
} satisfies AuthenticatedFluxerContext;

vi.mock('./db.server.js', () => ({
    getWebDb: vi.fn(),
}));

vi.mock('@neonflux/config', () => ({
    loadWebConfig: vi.fn(),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        listBotInstallationGuildIds: vi.fn(),
        listGuildSecurityPoliciesByGuildIds: vi.fn(),
        readDashboardGuildAuthorizationFacts: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/guilds', async (importActual) => {
    const actual = await importActual<typeof FluxerGuilds>();

    return {
        ...actual,
        listFluxerCurrentUserGuilds: vi.fn(),
    };
});

describe('authorizeDashboardPostingTarget', () => {
    beforeEach(() => {
        vi.mocked(getWebDb).mockResolvedValue({ db: {} } as Awaited<ReturnType<typeof getWebDb>>);
        vi.mocked(loadWebConfig).mockReturnValue({
            appEnv: 'production',
            guildDefconOverride: 'auto',
            logLevel: 'info',
            nodeEnv: 'test',
        });
        vi.mocked(readDashboardGuildAuthorizationFacts).mockResolvedValue(
            ok({
                botInstalled: true,
                deployment: { instanceMode: 'multi' },
                storedDefconLevel: null,
            })
        );
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValue(
            ok([createFluxerGuild({ id: 'guild-1', name: 'Guild One', permissions: '32' })])
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('rejects an empty target without reading database or provider state', async () => {
        await expect(authorizeDashboardPostingTarget(authContext, '   ')).resolves.toMatchObject({
            error: 'not-found',
        });

        expect(getWebDb).not.toHaveBeenCalled();
        expect(listFluxerCurrentUserGuilds).not.toHaveBeenCalled();
    });

    it('authorizes one installed manageable target from one facts read and one bounded provider read', async () => {
        const result = await authorizeDashboardPostingTarget(authContext, ' guild-1 ');

        expect(result._unsafeUnwrap()).toStrictEqual({
            guild: {
                botInstalled: true,
                canManage: true,
                id: 'guild-1',
                name: 'Guild One',
            },
            mode: { instanceMode: 'multi' },
        });
        expect(readDashboardGuildAuthorizationFacts).toHaveBeenCalledTimes(1);
        expect(readDashboardGuildAuthorizationFacts).toHaveBeenCalledWith({}, { guildId: 'guild-1' });
        expect(listFluxerCurrentUserGuilds).toHaveBeenCalledTimes(1);
        expect(listFluxerCurrentUserGuilds).toHaveBeenCalledWith({
            accessToken: authContext.accessToken,
            limit: 200,
        });
        expect(listBotInstallationGuildIds).not.toHaveBeenCalled();
        expect(listGuildSecurityPoliciesByGuildIds).not.toHaveBeenCalled();
    });

    it('preserves database and missing-deployment precedence over provider failures', async () => {
        vi.mocked(readDashboardGuildAuthorizationFacts).mockResolvedValueOnce(err('database-error'));
        vi.mocked(listFluxerCurrentUserGuilds).mockRejectedValueOnce(new Error('unexpected provider rejection'));

        await expect(authorizeDashboardPostingTarget(authContext, 'guild-1')).resolves.toMatchObject({
            error: 'database-error',
        });

        vi.mocked(readDashboardGuildAuthorizationFacts).mockResolvedValueOnce(
            ok({ botInstalled: false, deployment: null, storedDefconLevel: null })
        );
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValueOnce(
            err({ type: 'request-failed', status: 502, statusText: 'Bad Gateway' })
        );

        await expect(authorizeDashboardPostingTarget(authContext, 'guild-1')).resolves.toMatchObject({
            error: 'deployment-config-not-found',
        });
    });

    it('maps provider lookup failures and absent targets to guild-lookup-failed and not-found', async () => {
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValueOnce(
            err({ type: 'request-failed', status: 502, statusText: 'Bad Gateway' })
        );

        await expect(authorizeDashboardPostingTarget(authContext, 'guild-1')).resolves.toMatchObject({
            error: 'guild-lookup-failed',
        });

        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValueOnce(
            ok([createFluxerGuild({ id: 'another-guild', name: 'Another', permissions: '32' })])
        );

        await expect(authorizeDashboardPostingTarget(authContext, 'guild-1')).resolves.toMatchObject({
            error: 'not-found',
        });
    });

    it('requires the configured target in single mode without requiring a bot installation', async () => {
        vi.mocked(readDashboardGuildAuthorizationFacts).mockResolvedValueOnce(
            ok({
                botInstalled: false,
                deployment: { instanceMode: 'single', singleGuildId: 'guild-1' },
                storedDefconLevel: null,
            })
        );

        const result = await authorizeDashboardPostingTarget(authContext, 'guild-1');

        expect(result._unsafeUnwrap()).toMatchObject({
            guild: { botInstalled: false, id: 'guild-1' },
            mode: { instanceMode: 'single', singleGuildId: 'guild-1' },
        });

        vi.mocked(readDashboardGuildAuthorizationFacts).mockResolvedValueOnce(
            ok({
                botInstalled: true,
                deployment: { instanceMode: 'single', singleGuildId: 'another-guild' },
                storedDefconLevel: null,
            })
        );

        await expect(authorizeDashboardPostingTarget(authContext, 'guild-1')).resolves.toMatchObject({
            error: 'not-found',
        });
    });

    it('requires a target installation in multi mode', async () => {
        vi.mocked(readDashboardGuildAuthorizationFacts).mockResolvedValueOnce(
            ok({
                botInstalled: false,
                deployment: { instanceMode: 'multi' },
                storedDefconLevel: null,
            })
        );

        await expect(authorizeDashboardPostingTarget(authContext, 'guild-1')).resolves.toMatchObject({
            error: 'not-found',
        });
    });

    it('applies current DEFCON policy to managers and owners', async () => {
        vi.mocked(readDashboardGuildAuthorizationFacts).mockResolvedValueOnce(
            ok({
                botInstalled: true,
                deployment: { instanceMode: 'multi' },
                storedDefconLevel: 2,
            })
        );

        await expect(authorizeDashboardPostingTarget(authContext, 'guild-1')).resolves.toMatchObject({
            error: 'not-found',
        });

        vi.mocked(readDashboardGuildAuthorizationFacts).mockResolvedValueOnce(
            ok({
                botInstalled: true,
                deployment: { instanceMode: 'multi' },
                storedDefconLevel: 1,
            })
        );
        vi.mocked(listFluxerCurrentUserGuilds).mockResolvedValueOnce(
            ok([
                createFluxerGuild({
                    id: 'guild-1',
                    name: 'Guild One',
                    ownerId: authContext.fluxerUserId,
                    permissions: '0',
                }),
            ])
        );

        await expect(authorizeDashboardPostingTarget(authContext, 'guild-1')).resolves.toMatchObject({
            value: {
                guild: { canManage: false, ownerId: authContext.fluxerUserId },
            },
        });
    });

    it('maps database startup failures without hiding the concurrent provider request', async () => {
        vi.mocked(getWebDb).mockRejectedValueOnce(new Error('database unavailable'));

        await expect(authorizeDashboardPostingTarget(authContext, 'guild-1')).resolves.toMatchObject({
            error: 'database-error',
        });
        expect(listFluxerCurrentUserGuilds).toHaveBeenCalledTimes(1);
    });
});

function createFluxerGuild(input: { id: string; name: string; permissions: string; ownerId?: string }): {
    id: string;
    name: string;
    permissions: string;
    ownerId?: string;
} {
    return input;
}
