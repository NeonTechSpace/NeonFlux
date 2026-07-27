import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type * as FluxerUsers from '@neonflux/fluxer/users';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';
import { loadDashboardGuildPageDataForAuthenticatedContext } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';
import type { AuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1/blueprint');
const authContext: AuthenticatedFluxerContext = {
    accessToken: 'access-token',
    accessTokenExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
    fluxerUserId: 'user-1',
    scopes: ['identify', 'guilds'],
    session: {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        fluxerUserId: 'user-1',
        id: 'session-1',
        revokedAt: null,
    },
};

vi.mock('./dashboard-guild-page.server.js', () => ({
    loadDashboardGuildPageDataForAuthenticatedContext: vi.fn(),
}));

vi.mock('./fluxer-auth-context.server.js', () => ({
    readAuthenticatedFluxerContext: vi.fn(),
}));

vi.mock('@neonflux/fluxer/users', async (importActual) => {
    const actual = await importActual<typeof FluxerUsers>();

    return {
        ...actual,
        getFluxerCurrentUser: vi.fn(),
    };
});

describe('loadAuthorizedBlueprintContext', () => {
    beforeEach(() => {
        vi.mocked(readAuthenticatedFluxerContext).mockResolvedValue(ok(authContext));
        vi.mocked(loadDashboardGuildPageDataForAuthenticatedContext).mockResolvedValue({
            type: 'guild',
            mode: 'multi',
            guild: { id: 'guild-1', name: 'Guild One' },
        });
        vi.mocked(getFluxerCurrentUser).mockResolvedValue(
            ok({
                avatar: null,
                discriminator: '0',
                globalName: 'Neonsy',
                id: 'user-1',
                username: 'neonsy',
            })
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('uses one authenticated context for authorization and actor metadata', async () => {
        await expect(loadAuthorizedBlueprintContext(request, 'guild-1')).resolves.toStrictEqual({
            type: 'authorized',
            guild: { id: 'guild-1', name: 'Guild One' },
            actor: {
                type: 'actor',
                actorUserId: 'user-1',
                metadata: {
                    actorDisplayName: 'Neonsy',
                    actorUsername: 'neonsy',
                },
            },
        });

        expect(readAuthenticatedFluxerContext).toHaveBeenCalledOnce();
        expect(loadDashboardGuildPageDataForAuthenticatedContext).toHaveBeenCalledWith(authContext, 'guild-1');
        expect(getFluxerCurrentUser).toHaveBeenCalledWith({ accessToken: 'access-token' });
    });

    it('does not perform authorization or provider reads when authentication fails', async () => {
        vi.mocked(readAuthenticatedFluxerContext).mockResolvedValueOnce(err('missing-cookie'));

        await expect(loadAuthorizedBlueprintContext(request, 'guild-1')).resolves.toStrictEqual({
            type: 'auth-required',
        });
        expect(loadDashboardGuildPageDataForAuthenticatedContext).not.toHaveBeenCalled();
        expect(getFluxerCurrentUser).not.toHaveBeenCalled();
    });

    it('falls back to the authenticated identifier when provider metadata is unavailable', async () => {
        vi.mocked(getFluxerCurrentUser).mockResolvedValueOnce(
            err({ type: 'request-failed', status: 503, statusText: 'Service Unavailable' })
        );

        await expect(loadAuthorizedBlueprintContext(request, 'guild-1')).resolves.toMatchObject({
            type: 'authorized',
            actor: {
                actorUserId: 'user-1',
                metadata: {},
            },
        });
    });
});
