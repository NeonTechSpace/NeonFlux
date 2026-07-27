import { loadWebConfig } from '@neonflux/config';
import type * as NeonFluxConfig from '@neonflux/config';
import { revokeWebSession } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getWebDb } from './db.server.js';
import { handleLogoutRequest } from './logout.server.js';
import { createSessionCookie, SESSION_COOKIE_NAME } from './session-cookie.js';

const sessionId = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const sessionSecret = 'test-session-secret';

vi.mock('@neonflux/config', async (importActual) => {
    const actual = await importActual<typeof NeonFluxConfig>();

    return {
        ...actual,
        loadWebConfig: vi.fn(),
    };
});

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        revokeWebSession: vi.fn(),
    };
});

vi.mock('./db.server.js', () => ({
    getWebDb: vi.fn(),
}));

describe('handleLogoutRequest', () => {
    beforeEach(() => {
        vi.mocked(loadWebConfig).mockReturnValue({
            appEnv: 'development',
            guildDefconOverride: 'auto',
            logLevel: 'info',
            nodeEnv: 'test',
            sessionSecret,
        });
        vi.mocked(getWebDb).mockResolvedValue({
            client: {} as Awaited<ReturnType<typeof getWebDb>>['client'],
            db: {} as Awaited<ReturnType<typeof getWebDb>>['db'],
            deployment: 'test',
            serviceName: 'web',
            url: 'https://test.convex.cloud',
            close: vi.fn(),
        });
        vi.mocked(revokeWebSession).mockResolvedValue(
            ok({
                createdAt: new Date('2026-07-01T00:00:00.000Z'),
                expiresAt: new Date('2026-07-08T00:00:00.000Z'),
                fluxerUserId: 'user-1',
                id: sessionId,
                revokedAt: new Date('2026-07-01T01:00:00.000Z'),
            })
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('revokes the authenticated session, clears the browser cookie, and redirects', async () => {
        const response = await handleLogoutRequest(createLogoutRequest());

        expect(revokeWebSession).toHaveBeenCalledWith({}, { sessionId });
        expect(response.status).toBe(303);
        expect(response.headers.get('Location')).toBe('/auth/signed-out');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE_NAME}=`);
        expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    });

    it('is idempotent when the server session is already absent', async () => {
        vi.mocked(revokeWebSession).mockResolvedValueOnce(err('not-found'));

        const response = await handleLogoutRequest(createLogoutRequest());

        expect(response.status).toBe(303);
        expect(response.headers.get('Location')).toBe('/auth/signed-out');
    });

    it('clears local state but reports when server revocation cannot be confirmed', async () => {
        vi.mocked(revokeWebSession).mockResolvedValueOnce(err('database-error'));

        const response = await handleLogoutRequest(createLogoutRequest());

        expect(response.status).toBe(303);
        expect(response.headers.get('Location')).toBe('/auth/signed-out?revocation=unconfirmed');
        expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    });

    it('does not touch the database when no session cookie exists', async () => {
        const response = await handleLogoutRequest(createLogoutRequest({ cookie: null }));

        expect(response.headers.get('Location')).toBe('/auth/signed-out');
        expect(getWebDb).not.toHaveBeenCalled();
    });

    it('rejects cross-origin and non-POST requests without mutating session state', async () => {
        const crossOriginResponse = await handleLogoutRequest(
            createLogoutRequest({ origin: 'https://attacker.example' })
        );
        const getResponse = await handleLogoutRequest(
            new Request('http://localhost:3000/auth/logout', { method: 'GET' })
        );

        expect(crossOriginResponse.status).toBe(403);
        expect(crossOriginResponse.headers.get('Set-Cookie')).toBeNull();
        expect(getResponse.status).toBe(405);
        expect(getResponse.headers.get('Allow')).toBe('POST');
        expect(revokeWebSession).not.toHaveBeenCalled();
    });
});

function createLogoutRequest({
    cookie = createSignedSessionCookie(),
    origin = 'http://localhost:3000',
}: {
    cookie?: string | null;
    origin?: string;
} = {}): Request {
    const headers = new Headers({ Origin: origin });

    if (cookie) {
        headers.set('Cookie', cookie);
    }

    return new Request('http://localhost:3000/auth/logout', {
        method: 'POST',
        headers,
    });
}

function createSignedSessionCookie(): string {
    const cookieResult = createSessionCookie({
        appEnv: 'development',
        sessionId,
        sessionSecret,
    });

    return cookieResult._unsafeUnwrap().split(';')[0] ?? '';
}
