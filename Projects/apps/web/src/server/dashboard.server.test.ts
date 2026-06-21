import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildAccess } from './dashboard-guild-access.server.js';
import type { DashboardGuildAccess, DashboardGuildAccessError } from './dashboard-guild-access.server.js';
import { handleDashboardRequest } from './dashboard.server.js';

const request = new Request('http://localhost:3000/dashboard');
const sessionId = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const fluxerUserId = '1517169145576165376';
const accessToken = 'fresh-access-token';
const guildId = 'guild-1';

vi.mock('./dashboard-guild-access.server.js', () => ({
    loadDashboardGuildAccess: vi.fn(),
}));

describe('handleDashboardRequest', () => {
    beforeEach(() => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValue(ok(createAuthorizedGuildAccess()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns 200 when dashboard guild access is authorized', async () => {
        const response = await handleDashboardRequest(request);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('NeonFlux dashboard guild access validated.');
    });

    it('returns 403 when single-instance guild access is unauthorized', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(
            ok({
                type: 'unauthorized',
                mode: {
                    instanceMode: 'single',
                    singleGuildId: guildId,
                },
                configuredGuildId: guildId,
                configuredGuildName: 'Configured Community',
            })
        );

        const response = await handleDashboardRequest(request);

        expect(response.status).toBe(403);
        expect(await response.text()).toBe('You are not authorized to modify the configured community.');
    });

    it('returns 200 when multi-instance access has no manageable guilds', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(
            ok({
                type: 'no-manageable-guilds',
                mode: {
                    instanceMode: 'multi',
                },
            })
        );

        const response = await handleDashboardRequest(request);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('No manageable communities found.');
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
    ] satisfies DashboardGuildAccessError[])('redirects to Fluxer login for recoverable %s errors', async (error) => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(err(error));

        const response = await handleDashboardRequest(request);

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/auth/fluxer/login');
    });

    it('returns 500 when dashboard access hits a database error', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(err('database-error'));

        const response = await handleDashboardRequest(request);

        expect(response.status).toBe(500);
        expect(await response.text()).toBe('NeonFlux dashboard unavailable.');
    });

    it('returns 502 when Fluxer guild lookup fails', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(err('guild-lookup-failed'));

        const response = await handleDashboardRequest(request);

        expect(response.status).toBe(502);
        expect(await response.text()).toBe('NeonFlux dashboard unavailable.');
    });

    it('does not expose session, user, token, or guild identifiers in response bodies', async () => {
        const response = await handleDashboardRequest(request);
        const responseText = await response.text();

        expect(responseText).not.toContain(sessionId);
        expect(responseText).not.toContain(fluxerUserId);
        expect(responseText).not.toContain(accessToken);
        expect(responseText).not.toContain(guildId);
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
                id: guildId,
                name: 'Guild One',
                canManage: true,
                botInstalled: true,
            },
        ],
    };
}
