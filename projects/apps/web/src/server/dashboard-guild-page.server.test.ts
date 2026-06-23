import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildAccess } from './dashboard-guild-access.server.js';
import type { DashboardGuildAccess, DashboardGuildAccessError } from './dashboard-guild-access.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';

const request = new Request('http://localhost:3000/dashboard/guild-1');

vi.mock('./dashboard-guild-access.server.js', () => ({
    loadDashboardGuildAccess: vi.fn(),
}));

describe('loadDashboardGuildPageData', () => {
    beforeEach(() => {
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
            },
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
        });
    });

    it('returns not-found for a guild outside the manageable list', async () => {
        await expect(loadDashboardGuildPageData(request, 'guild-2')).resolves.toStrictEqual({
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
                canManage: true,
                botInstalled: true,
            },
        ],
    };
}
