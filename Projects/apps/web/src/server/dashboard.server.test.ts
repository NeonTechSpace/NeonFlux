import { findActiveWebSessionById } from '@neonflux/db';
import type { WebSessionRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionCookie, SESSION_COOKIE_NAME } from './session-cookie.js';
import { handleDashboardRequest } from './dashboard.server.js';

const sessionSecret = 'session-secret';
const sessionId = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const otherSessionId = '9876543210abcdefghijklmnopqrstuvwxyzABCDEFG';
const activeSession = {
    id: sessionId,
    fluxerUserId: '1517169145576165376',
    createdAt: new Date('2026-06-21T00:00:00.000Z'),
    expiresAt: new Date('2026-06-28T00:00:00.000Z'),
    revokedAt: null,
} satisfies WebSessionRecord;

vi.mock('./database.server.js', () => ({
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

describe('handleDashboardRequest', () => {
    beforeEach(() => {
        stubSessionEnv();
        vi.mocked(findActiveWebSessionById).mockResolvedValue(ok(activeSession));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('returns 200 when the request has a valid active session', async () => {
        const response = await handleDashboardRequest(createDashboardRequest(createValidSessionCookie(sessionId)));

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('NeonFlux dashboard session validated.');
    });

    it('redirects to Fluxer login when the session cookie is missing', async () => {
        const response = await handleDashboardRequest(createDashboardRequest('other=value'));

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/auth/fluxer/login');
        expect(findActiveWebSessionById).not.toHaveBeenCalled();
    });

    it('redirects to Fluxer login when the session cookie is invalid', async () => {
        const response = await handleDashboardRequest(createDashboardRequest(`${SESSION_COOKIE_NAME}=invalid`));

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/auth/fluxer/login');
        expect(findActiveWebSessionById).not.toHaveBeenCalled();
    });

    it('redirects to Fluxer login when the session cookie signature is invalid', async () => {
        const tamperedCookie = createValidSessionCookie(sessionId).replace(
            `${SESSION_COOKIE_NAME}=${sessionId}.`,
            `${SESSION_COOKIE_NAME}=${otherSessionId}.`
        );

        const response = await handleDashboardRequest(createDashboardRequest(tamperedCookie));

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/auth/fluxer/login');
        expect(findActiveWebSessionById).not.toHaveBeenCalled();
    });

    it('redirects to Fluxer login when the session is not active', async () => {
        vi.mocked(findActiveWebSessionById).mockResolvedValueOnce(err('not-found'));

        const response = await handleDashboardRequest(createDashboardRequest(createValidSessionCookie(sessionId)));

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/auth/fluxer/login');
    });

    it('returns 500 when session validation hits a DB error', async () => {
        vi.mocked(findActiveWebSessionById).mockResolvedValueOnce(err('database-error'));

        const response = await handleDashboardRequest(createDashboardRequest(createValidSessionCookie(sessionId)));

        expect(response.status).toBe(500);
        expect(await response.text()).toBe('NeonFlux dashboard unavailable.');
    });

    it('does not expose session or user identifiers in the response body', async () => {
        const response = await handleDashboardRequest(createDashboardRequest(createValidSessionCookie(sessionId)));
        const responseText = await response.text();

        expect(responseText).not.toContain(sessionId);
        expect(responseText).not.toContain(activeSession.fluxerUserId);
    });
});

function stubSessionEnv(): void {
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('INSTANCE_MODE', 'multi');
    vi.stubEnv('SESSION_SECRET', sessionSecret);
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
