import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboardGuildAccess } from '../server/dashboard-guild-access.server.js';
import { dashboardRouteOptions } from './dashboard.js';

vi.mock('../server/dashboard-guild-access.server.js', () => ({
    loadDashboardGuildAccess: vi.fn(),
}));

describe('/dashboard', () => {
    beforeEach(() => {
        vi.mocked(loadDashboardGuildAccess).mockResolvedValue(
            ok({
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
            })
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns 200 when the route GET handler validates dashboard guild access', async () => {
        const handler = getDashboardGetHandler();
        const response = await handler({
            request: new Request('http://localhost:3000/dashboard'),
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('NeonFlux dashboard guild access validated.');
    });
});

function getDashboardGetHandler(): NonNullable<typeof dashboardRouteOptions.server.handlers>['GET'] {
    const handler = dashboardRouteOptions.server.handlers.GET;

    if (typeof handler !== 'function') {
        throw new Error('Dashboard GET handler is missing.');
    }

    return handler;
}
