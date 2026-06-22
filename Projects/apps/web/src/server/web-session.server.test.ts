import { findActiveWebSessionById } from '@neonflux/db';
import type { WebSessionRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionCookie, SESSION_COOKIE_NAME } from './session-cookie.js';
import { readAuthenticatedWebSession } from './web-session.server.js';

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

describe('readAuthenticatedWebSession', () => {
    beforeEach(() => {
        stubSessionEnv();
        vi.mocked(findActiveWebSessionById).mockResolvedValue(ok(activeSession));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('returns the active DB session for a valid signed cookie', async () => {
        const result = await readAuthenticatedWebSession(createSessionRequest(createValidSessionCookie(sessionId)));

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual(activeSession);
    });

    it('queries DB with the decoded session id from the signed cookie', async () => {
        await readAuthenticatedWebSession(createSessionRequest(createValidSessionCookie(sessionId)));

        expect(findActiveWebSessionById).toHaveBeenCalledWith(
            {},
            {
                sessionId,
            }
        );
    });

    it('returns missing-cookie and does not query DB when the cookie is absent', async () => {
        const result = await readAuthenticatedWebSession(createSessionRequest('other=value'));

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-cookie');
        expect(findActiveWebSessionById).not.toHaveBeenCalled();
    });

    it('returns invalid-cookie and does not query DB when the cookie is malformed', async () => {
        const result = await readAuthenticatedWebSession(createSessionRequest(`${SESSION_COOKIE_NAME}=not-signed`));

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-cookie');
        expect(findActiveWebSessionById).not.toHaveBeenCalled();
    });

    it('returns invalid-signature and does not query DB when the cookie is tampered with', async () => {
        const tamperedCookie = createValidSessionCookie(sessionId).replace(
            `${SESSION_COOKIE_NAME}=${sessionId}.`,
            `${SESSION_COOKIE_NAME}=${otherSessionId}.`
        );

        const result = await readAuthenticatedWebSession(createSessionRequest(tamperedCookie));

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-signature');
        expect(findActiveWebSessionById).not.toHaveBeenCalled();
    });

    it('returns not-found when DB session validation does not find an active session', async () => {
        vi.mocked(findActiveWebSessionById).mockResolvedValueOnce(err('not-found'));

        const result = await readAuthenticatedWebSession(createSessionRequest(createValidSessionCookie(sessionId)));

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('not-found');
    });

    it('returns database-error when DB session validation fails', async () => {
        vi.mocked(findActiveWebSessionById).mockResolvedValueOnce(err('database-error'));

        const result = await readAuthenticatedWebSession(createSessionRequest(createValidSessionCookie(sessionId)));

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });

    it('throws clearly when SESSION_SECRET is missing', async () => {
        vi.stubEnv('SESSION_SECRET', '');

        await expect(
            readAuthenticatedWebSession(createSessionRequest(createValidSessionCookie(sessionId)))
        ).rejects.toThrow('SESSION_SECRET is required');
        expect(findActiveWebSessionById).not.toHaveBeenCalled();
    });
});

function stubSessionEnv(): void {
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('SESSION_SECRET', sessionSecret);
}

function createSessionRequest(cookie: string): Request {
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
