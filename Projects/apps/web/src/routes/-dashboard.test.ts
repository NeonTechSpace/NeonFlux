import { findActiveWebSessionById } from '@neonflux/db';
import type { WebSessionRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionCookie } from '../server/session-cookie.js';
import { dashboardRouteOptions } from './dashboard.js';

const sessionSecret = 'session-secret';
const sessionId = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const activeSession = {
    id: sessionId,
    fluxerUserId: '1517169145576165376',
    createdAt: new Date('2026-06-21T00:00:00.000Z'),
    expiresAt: new Date('2026-06-28T00:00:00.000Z'),
    revokedAt: null,
} satisfies WebSessionRecord;

vi.mock('../server/database.server.js', () => ({
    getWebDatabaseClient: () => ({
        db: {},
    }),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        findActiveWebSessionById: vi.fn(),
    };
});

describe('/dashboard', () => {
    beforeEach(() => {
        vi.stubEnv('APP_ENV', 'development');
        vi.stubEnv('INSTANCE_MODE', 'multi');
        vi.stubEnv('SESSION_SECRET', sessionSecret);
        vi.mocked(findActiveWebSessionById).mockResolvedValue(ok(activeSession));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('returns 200 when the route GET handler receives a valid active session', async () => {
        const handler = getDashboardGetHandler();
        const response = await handler({
            request: createDashboardRequest(createValidSessionCookie(sessionId)),
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('NeonFlux dashboard session validated.');
    });
});

function getDashboardGetHandler(): NonNullable<typeof dashboardRouteOptions.server.handlers>['GET'] {
    const handler = dashboardRouteOptions.server.handlers.GET;

    if (typeof handler !== 'function') {
        throw new Error('Dashboard GET handler is missing.');
    }

    return handler;
}

function createDashboardRequest(cookie: string): Request {
    return new Request('http://localhost:3000/dashboard', {
        headers: {
            Cookie: cookie,
        },
    });
}

function createValidSessionCookie(id: string): string {
    const cookieResult = createSessionCookie({
        sessionId: id,
        sessionSecret,
        appEnv: 'development',
    });

    expect(cookieResult.isOk()).toBe(true);

    const cookiePair = cookieResult._unsafeUnwrap().split(';')[0];

    expect(cookiePair).toBeDefined();

    return cookiePair;
}
