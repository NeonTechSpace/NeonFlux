import '@tanstack/react-start/server-only';

import { loadConfig } from '@neonflux/config';
import {
    findUsableFluxerOAuthTokenSetByUserId,
    invalidateFluxerOAuthTokenSet,
    upsertFluxerOAuthTokenSet,
} from '@neonflux/db';
import type {
    EncryptedOAuthTokenPayload,
    FluxerOAuthTokenRecord,
    FluxerOAuthTokenRepositoryError,
    WebSessionRecord,
} from '@neonflux/db';
import { refreshFluxerOAuthToken } from '@neonflux/fluxer/oauth';
import type { FluxerOAuthTokenRefreshError } from '@neonflux/fluxer/oauth';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { getWebDatabaseClient } from './database.server.js';
import { decryptFluxerToken, encryptFluxerToken } from './fluxer-token-crypto.js';
import type { EncryptedFluxerToken, FluxerTokenCryptoError } from './fluxer-token-crypto.js';
import { readAuthenticatedWebSession } from './web-session.server.js';
import type { WebSessionValidationError } from './web-session.server.js';

export type AuthenticatedFluxerContext = {
    session: WebSessionRecord;
    fluxerUserId: string;
    accessToken: string;
    scopes: string[];
    accessTokenExpiresAt: Date;
};

export type AuthenticatedFluxerContextError =
    | WebSessionValidationError
    | 'missing-token-set'
    | 'token-expired'
    | 'missing-refresh-token'
    | 'token-refresh-failed'
    | 'invalid-token-payload'
    | 'decrypt-failed'
    | 'database-error';

type WebDatabase = ReturnType<typeof getWebDatabaseClient>['db'];

export async function readAuthenticatedFluxerContext(
    request: Request
): Promise<Result<AuthenticatedFluxerContext, AuthenticatedFluxerContextError>> {
    const sessionResult = await readAuthenticatedWebSession(request);

    if (sessionResult.isErr()) {
        return err(sessionResult.error);
    }

    const config = loadConfig();
    const tokenEncryptionKey = requireConfigValue(config.fluxerTokenEncryptionKey, 'FLUXER_TOKEN_ENCRYPTION_KEY');
    const database = getWebDatabaseClient();
    const tokenSetResult = await findUsableFluxerOAuthTokenSetByUserId(database.db, {
        fluxerUserId: sessionResult.value.fluxerUserId,
    });

    if (tokenSetResult.isErr()) {
        return err(mapTokenRepositoryError(tokenSetResult.error));
    }

    const tokenSet = tokenSetResult.value;

    if (tokenSet.accessTokenExpiresAt.getTime() <= Date.now()) {
        if (!tokenSet.refreshToken) {
            return err('missing-refresh-token');
        }

        const appId = requireConfigValue(config.fluxerAppId, 'FLUXER_APP_ID');
        const clientSecret = requireConfigValue(config.fluxerClientSecret, 'FLUXER_CLIENT_SECRET');

        return refreshExpiredFluxerTokenContext({
            db: database.db,
            session: sessionResult.value,
            tokenSet,
            tokenEncryptionKey,
            appId,
            clientSecret,
        });
    }

    const accessTokenResult = decryptFluxerToken({
        encryptedToken: toEncryptedFluxerToken(tokenSet.accessToken),
        encryptionKey: tokenEncryptionKey,
    });

    if (accessTokenResult.isErr()) {
        return err(mapFluxerTokenCryptoError(accessTokenResult.error));
    }

    return ok({
        session: sessionResult.value,
        fluxerUserId: sessionResult.value.fluxerUserId,
        accessToken: accessTokenResult.value,
        scopes: tokenSet.scopes,
        accessTokenExpiresAt: tokenSet.accessTokenExpiresAt,
    });
}

async function refreshExpiredFluxerTokenContext(input: {
    db: WebDatabase;
    session: WebSessionRecord;
    tokenSet: FluxerOAuthTokenRecord;
    tokenEncryptionKey: string;
    appId: string;
    clientSecret: string;
}): Promise<Result<AuthenticatedFluxerContext, AuthenticatedFluxerContextError>> {
    if (!input.tokenSet.refreshToken) {
        return err('missing-refresh-token');
    }

    const refreshTokenResult = decryptFluxerToken({
        encryptedToken: toEncryptedFluxerToken(input.tokenSet.refreshToken),
        encryptionKey: input.tokenEncryptionKey,
    });

    if (refreshTokenResult.isErr()) {
        return err(mapFluxerTokenCryptoError(refreshTokenResult.error));
    }

    const refreshedTokenResult = await refreshFluxerOAuthToken({
        appId: input.appId,
        clientSecret: input.clientSecret,
        refreshToken: refreshTokenResult.value,
    });

    if (refreshedTokenResult.isErr()) {
        return handleTokenRefreshFailure({
            db: input.db,
            fluxerUserId: input.session.fluxerUserId,
            error: refreshedTokenResult.error,
        });
    }

    const encryptedAccessTokenResult = encryptFluxerToken({
        token: refreshedTokenResult.value.accessToken,
        encryptionKey: input.tokenEncryptionKey,
    });

    if (encryptedAccessTokenResult.isErr()) {
        return err(mapFluxerTokenCryptoError(encryptedAccessTokenResult.error));
    }

    const encryptedRefreshTokenResult = encryptFluxerToken({
        token: refreshedTokenResult.value.refreshToken,
        encryptionKey: input.tokenEncryptionKey,
    });

    if (encryptedRefreshTokenResult.isErr()) {
        return err(mapFluxerTokenCryptoError(encryptedRefreshTokenResult.error));
    }

    const accessToken: EncryptedOAuthTokenPayload = encryptedAccessTokenResult.value;
    const refreshToken: EncryptedOAuthTokenPayload = encryptedRefreshTokenResult.value;
    const accessTokenExpiresAt = new Date(Date.now() + refreshedTokenResult.value.expiresIn * 1000);
    const scopes = parseOAuthScopes(refreshedTokenResult.value.scope);
    const persistedTokenResult = await upsertFluxerOAuthTokenSet(input.db, {
        fluxerUserId: input.session.fluxerUserId,
        accessToken,
        refreshToken,
        tokenType: refreshedTokenResult.value.tokenType,
        accessTokenExpiresAt,
        scopes,
    });

    if (persistedTokenResult.isErr()) {
        return err(mapTokenRepositoryError(persistedTokenResult.error));
    }

    return ok({
        session: input.session,
        fluxerUserId: input.session.fluxerUserId,
        accessToken: refreshedTokenResult.value.accessToken,
        scopes: persistedTokenResult.value.scopes,
        accessTokenExpiresAt: persistedTokenResult.value.accessTokenExpiresAt,
    });
}

async function handleTokenRefreshFailure(input: {
    db: WebDatabase;
    fluxerUserId: string;
    error: FluxerOAuthTokenRefreshError;
}): Promise<Result<AuthenticatedFluxerContext, AuthenticatedFluxerContextError>> {
    switch (input.error.type) {
        case 'request-failed': {
            const invalidationResult = await invalidateFluxerOAuthTokenSet(input.db, {
                fluxerUserId: input.fluxerUserId,
            });

            if (invalidationResult.isErr()) {
                return err('database-error');
            }

            return err('token-refresh-failed');
        }

        case 'invalid-response':
        case 'network-error':
        case 'missing-input':
            return err('token-refresh-failed');
    }
}

function requireConfigValue(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`${name} is required`);
    }

    return value;
}

function mapTokenRepositoryError(error: FluxerOAuthTokenRepositoryError): AuthenticatedFluxerContextError {
    switch (error) {
        case 'not-found':
            return 'missing-token-set';

        case 'database-error':
            return 'database-error';

        case 'missing-fluxer-user-id':
        case 'invalid-access-token':
        case 'invalid-refresh-token':
        case 'missing-token-type':
        case 'invalid-expiry':
        case 'missing-scopes':
            return 'database-error';
    }
}

function mapFluxerTokenCryptoError(error: FluxerTokenCryptoError): AuthenticatedFluxerContextError {
    switch (error) {
        case 'invalid-payload':
            return 'invalid-token-payload';

        case 'decrypt-failed':
        case 'invalid-key':
            return 'decrypt-failed';

        case 'missing-key':
            throw new Error('FLUXER_TOKEN_ENCRYPTION_KEY is required');
    }
}

function parseOAuthScopes(scope: string): string[] {
    return scope.split(/\s+/).filter((value) => value.length > 0);
}

function toEncryptedFluxerToken(encryptedToken: EncryptedOAuthTokenPayload): EncryptedFluxerToken {
    return encryptedToken as EncryptedFluxerToken;
}
