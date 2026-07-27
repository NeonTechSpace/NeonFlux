import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import { revokeWebSession } from '@neonflux/db';

import { getWebDb } from './db.server.js';
import { createClearSessionCookie, readSessionCookie } from './session-cookie.js';

const signedOutPath = '/auth/signed-out';
const unconfirmedRevocationPath = `${signedOutPath}?revocation=unconfirmed`;

export async function handleLogoutRequest(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', {
            status: 405,
            headers: { Allow: 'POST' },
        });
    }

    if (!isSameOriginRequest(request)) {
        return new Response('Forbidden', { status: 403 });
    }

    const config = loadWebConfig();
    const cookieResult = readSessionCookie({
        request,
        sessionSecret: config.sessionSecret,
    });
    let revocationConfirmed = cookieResult.isErr() && cookieResult.error === 'missing-cookie';

    if (cookieResult.isOk()) {
        try {
            const database = await getWebDb();
            const revokeResult = await revokeWebSession(database.db, {
                sessionId: cookieResult.value.sessionId,
            });

            revocationConfirmed = revokeResult.isOk() || revokeResult.error === 'not-found';
        } catch {
            revocationConfirmed = false;
        }
    }

    return new Response(null, {
        status: 303,
        headers: {
            'Cache-Control': 'no-store',
            Location: revocationConfirmed ? signedOutPath : unconfirmedRevocationPath,
            'Set-Cookie': createClearSessionCookie(config.appEnv),
        },
    });
}

function isSameOriginRequest(request: Request): boolean {
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site') {
        return false;
    }

    const requestOrigin = new URL(request.url).origin;
    const origin = request.headers.get('Origin');

    return origin === null || origin === requestOrigin;
}
