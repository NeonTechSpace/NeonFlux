import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildAccess } from './dashboard-guild-access.server.js';
import type { DashboardGuildAccess, DashboardGuildAccessError } from './dashboard-guild-access.server.js';
import { loadDashboardData } from './dashboard.server.js';

const request = new Request('http://localhost:3000/dashboard');
const guildId = 'guild-1';

vi.mock('./dashboard-guild-access.server.js', () => ({
    loadDashboardGuildAccess: vi.fn(),
}));

describe('loadDashboardData', () => {
    beforeEach(() => {
        vi.stubEnv('FLUXER_BOT_INVITE_URL', '');
        vi.mocked(loadDashboardGuildAccess).mockResolvedValue(ok(createAuthorizedGuildAccess()));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('maps authorized guild access to a dashboard view model', async () => {
        const result = await loadDashboardData(request);

        expect(result).toStrictEqual({
            type: 'dashboard',
            viewModel: {
                type: 'guild-list',
                mode: 'multi',
                guilds: [
                    {
                        id: guildId,
                        name: 'Guild One',
                    },
                ],
            },
        });
    });

    it('maps single-instance unauthorized access to a dashboard view model', async () => {
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

        const result = await loadDashboardData(request);

        expect(result).toStrictEqual({
            type: 'dashboard',
            viewModel: {
                type: 'single-unauthorized',
                configuredGuildId: guildId,
                configuredGuildName: 'Configured Community',
            },
        });
    });

    it('maps multi-instance empty access to a dashboard view model', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(
            ok({
                type: 'no-manageable-guilds',
                mode: {
                    instanceMode: 'multi',
                },
            })
        );

        const result = await loadDashboardData(request);

        expect(result).toStrictEqual({
            type: 'dashboard',
            viewModel: {
                type: 'multi-empty',
            },
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

        await expect(loadDashboardData(request)).resolves.toStrictEqual({ type: 'auth-required' });
    });

    it('maps DB failures to database-error', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(err('database-error'));

        await expect(loadDashboardData(request)).resolves.toStrictEqual({ type: 'database-error' });
    });

    it('maps missing deployment config to deployment-config-not-found', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(err('deployment-config-not-found'));

        await expect(loadDashboardData(request)).resolves.toStrictEqual({ type: 'deployment-config-not-found' });
    });

    it('maps Fluxer guild lookup failures to guild-lookup-failed', async () => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValueOnce(err('guild-lookup-failed'));

        await expect(loadDashboardData(request)).resolves.toStrictEqual({ type: 'guild-lookup-failed' });
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
