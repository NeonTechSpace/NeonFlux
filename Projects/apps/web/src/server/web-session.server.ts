import '@tanstack/react-start/server-only';

import { loadConfig } from '@neonflux/config';
import { findActiveWebSessionById } from '@neonflux/db';
import type { WebSessionRecord, WebSessionRepositoryError } from '@neonflux/db';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { getWebDatabaseClient } from './database.server.js';
import { readSessionCookie } from './session-cookie.js';
import type { SessionCookieError } from './session-cookie.js';

export type WebSessionValidationError =
    | 'missing-cookie'
    | 'invalid-cookie'
    | 'invalid-signature'
    | 'not-found'
    | 'database-error';

export async function readAuthenticatedWebSession(
    request: Request
): Promise<Result<WebSessionRecord, WebSessionValidationError>> {
    const config = loadConfig();
    const sessionSecret = requireConfigValue(config.sessionSecret, 'SESSION_SECRET');
    const cookieResult = readSessionCookie({
        request,
        sessionSecret,
    });

    if (cookieResult.isErr()) {
        return err(mapSessionCookieError(cookieResult.error));
    }

    const database = getWebDatabaseClient();
    const sessionResult = await findActiveWebSessionById(database.db, {
        sessionId: cookieResult.value.sessionId,
    });

    if (sessionResult.isErr()) {
        return err(mapWebSessionRepositoryError(sessionResult.error));
    }

    return ok(sessionResult.value);
}

function requireConfigValue(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`${name} is required`);
    }

    return value;
}

function mapSessionCookieError(error: SessionCookieError): WebSessionValidationError {
    switch (error) {
        case 'missing-cookie':
        case 'invalid-cookie':
        case 'invalid-signature':
            return error;

        case 'missing-secret':
            throw new Error('SESSION_SECRET is required');
    }
}

function mapWebSessionRepositoryError(error: WebSessionRepositoryError): WebSessionValidationError {
    switch (error) {
        case 'not-found':
        case 'database-error':
            return error;

        case 'missing-session-id':
        case 'missing-fluxer-user-id':
        case 'invalid-expiry':
            return 'database-error';
    }
}
