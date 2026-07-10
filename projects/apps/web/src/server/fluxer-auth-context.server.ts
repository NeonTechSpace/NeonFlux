import { randomUUID } from 'node:crypto';

import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    claimFluxerOAuthTokenRefreshLease,
    completeFluxerOAuthTokenRefresh,
    findUsableFluxerOAuthTokenSetByUserId,
    invalidateFluxerOAuthTokenSet,
    recordFluxerOAuthTokenRefreshFailure,
} from '@neonflux/db';
import type {
    EncryptedOAuthTokenPayload,
    FluxerOAuthTokenRecord,
    FluxerOAuthTokenRepositoryError,
    RuntimeDbClient,
    WebSessionRecord,
} from '@neonflux/db';
import { refreshFluxerOAuthToken } from '@neonflux/fluxer/oauth';
import type { FluxerOAuthTokenRefreshError, FluxerOAuthTokenResponse } from '@neonflux/fluxer/oauth';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { getWebDb } from './db.server.js';
import { decryptFluxerToken, encryptFluxerToken } from './fluxer-token-crypto.js';
import type { EncryptedFluxerToken, FluxerTokenCryptoError } from './fluxer-token-crypto.js';
import { readAuthenticatedWebSession } from './web-session.server.js';
import type { WebSessionValidationError } from './web-session.server.js';

const accessTokenRefreshSkewMs = 60_000;
const refreshLeaseDurationMs = 60_000;
const refreshFailureCooldownMs = 5_000;
const refreshFailureMaximumCooldownMs = 30_000;
const repositoryRetryDelayMs = 50;
const refreshWinnerMaximumPollDelayMs = 5_000;
const refreshLeaseOwner = `web:${randomUUID()}`;

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

type WebDatabase = RuntimeDbClient['db'];

type FluxerCredential = {
    accessToken: string;
    accessTokenExpiresAt: Date;
    scopes: string[];
};

type RefreshInput = {
    appId: string;
    clientSecret: string;
    db: WebDatabase;
    fluxerUserId: string;
    tokenEncryptionKey: string;
    tokenSet: FluxerOAuthTokenRecord;
};

type ClaimedRefresh = RefreshInput & {
    leaseId: string;
};

const inFlightRefreshes = new Map<string, Promise<Result<FluxerCredential, AuthenticatedFluxerContextError>>>();

export async function readAuthenticatedFluxerContext(
    request: Request
): Promise<Result<AuthenticatedFluxerContext, AuthenticatedFluxerContextError>> {
    const sessionResult = await readAuthenticatedWebSession(request);

    if (sessionResult.isErr()) {
        return err(sessionResult.error);
    }

    const config = loadWebConfig();
    const tokenEncryptionKey = requireConfigValue(config.fluxerTokenEncryptionKey, 'FLUXER_TOKEN_ENCRYPTION_KEY');
    const database = await getWebDb();
    const tokenSetResult = await findUsableFluxerOAuthTokenSetByUserId(database.db, {
        fluxerUserId: sessionResult.value.fluxerUserId,
    });

    if (tokenSetResult.isErr()) {
        return err(mapTokenRepositoryError(tokenSetResult.error));
    }

    const tokenSet = tokenSetResult.value;
    let credentialResult: Result<FluxerCredential, AuthenticatedFluxerContextError>;

    if (shouldRefreshAccessToken(tokenSet, Date.now())) {
        if (!tokenSet.refreshToken) {
            return err('missing-refresh-token');
        }

        credentialResult = await refreshFluxerCredentialSingleFlight({
            appId: requireConfigValue(config.fluxerAppId, 'FLUXER_APP_ID'),
            clientSecret: requireConfigValue(config.fluxerClientSecret, 'FLUXER_CLIENT_SECRET'),
            db: database.db,
            fluxerUserId: sessionResult.value.fluxerUserId,
            tokenEncryptionKey,
            tokenSet,
        });
    } else {
        // The Neverthrow rule cannot follow assignment to an already-declared variable;
        // credentialResult is handled immediately below.
        // eslint-disable-next-line neverthrow/must-use-result
        credentialResult = readStoredFluxerCredential(tokenSet, tokenEncryptionKey, Date.now());
    }

    if (credentialResult.isErr()) {
        return err(credentialResult.error);
    }

    return ok({
        session: sessionResult.value,
        fluxerUserId: sessionResult.value.fluxerUserId,
        ...credentialResult.value,
    });
}

function refreshFluxerCredentialSingleFlight(
    input: RefreshInput
): Promise<Result<FluxerCredential, AuthenticatedFluxerContextError>> {
    const existingRefresh = inFlightRefreshes.get(input.fluxerUserId);

    if (existingRefresh) {
        return existingRefresh;
    }

    const refresh = refreshFluxerCredentialWithLease(input);
    inFlightRefreshes.set(input.fluxerUserId, refresh);

    const clearRefresh = () => {
        if (inFlightRefreshes.get(input.fluxerUserId) === refresh) {
            inFlightRefreshes.delete(input.fluxerUserId);
        }
    };

    void refresh.then(clearRefresh, clearRefresh);

    return refresh;
}

async function refreshFluxerCredentialWithLease(
    input: RefreshInput
): Promise<Result<FluxerCredential, AuthenticatedFluxerContextError>> {
    const leaseId = randomUUID();
    const claimResult = await claimFluxerOAuthTokenRefreshLease(input.db, {
        expectedGeneration: input.tokenSet.credentialGeneration,
        fluxerUserId: input.fluxerUserId,
        leaseId,
        leaseOwner: refreshLeaseOwner,
    });

    if (claimResult.isErr()) {
        return err(mapTokenRepositoryError(claimResult.error));
    }

    switch (claimResult.value.status) {
        case 'claimed':
            return performClaimedFluxerTokenRefresh({ ...input, leaseId });

        case 'busy':
            return waitForRefreshWinner(input, claimResult.value.retryAt);

        case 'stale':
            return readRefreshWinner(input);

        case 'cooldown':
            return err('token-refresh-failed');

        case 'missing':
            return err('missing-token-set');
    }
}

async function performClaimedFluxerTokenRefresh(
    input: ClaimedRefresh
): Promise<Result<FluxerCredential, AuthenticatedFluxerContextError>> {
    if (!input.tokenSet.refreshToken) {
        await recordRefreshFailure(input, refreshFailureCooldownMs);
        return err('missing-refresh-token');
    }

    const refreshTokenResult = decryptFluxerToken({
        encryptedToken: toEncryptedFluxerToken(input.tokenSet.refreshToken),
        encryptionKey: input.tokenEncryptionKey,
    });

    if (refreshTokenResult.isErr()) {
        await recordRefreshFailure(input, refreshFailureCooldownMs);
        return err(mapFluxerTokenCryptoError(refreshTokenResult.error));
    }

    const refreshedTokenResult = await refreshFluxerOAuthToken({
        appId: input.appId,
        clientSecret: input.clientSecret,
        refreshToken: refreshTokenResult.value,
    });

    if (refreshedTokenResult.isErr()) {
        if (refreshedTokenResult.error.type === 'terminal-response') {
            return invalidateTerminalRefreshCredential(input);
        }

        await recordRefreshFailure(input, readRefreshFailureCooldownMs(refreshedTokenResult.error));
        return err('token-refresh-failed');
    }

    const encryptedTokensResult = encryptRefreshedTokens(refreshedTokenResult.value, input.tokenEncryptionKey);

    if (encryptedTokensResult.isErr()) {
        await recordRefreshFailure(input, refreshFailureCooldownMs);
        return err(encryptedTokensResult.error);
    }

    return completeRefreshedCredential(input, refreshedTokenResult.value, encryptedTokensResult.value);
}

async function completeRefreshedCredential(
    input: ClaimedRefresh,
    refreshedToken: FluxerOAuthTokenResponse,
    encryptedTokens: { accessToken: EncryptedOAuthTokenPayload; refreshToken: EncryptedOAuthTokenPayload }
): Promise<Result<FluxerCredential, AuthenticatedFluxerContextError>> {
    const accessTokenExpiresAt = new Date(Date.now() + refreshedToken.expiresIn * 1_000);
    const scopes = parseOAuthScopes(refreshedToken.scope);

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const completionResult = await completeFluxerOAuthTokenRefresh(input.db, {
            ...encryptedTokens,
            accessTokenExpiresAt,
            expectedGeneration: input.tokenSet.credentialGeneration,
            fluxerUserId: input.fluxerUserId,
            leaseId: input.leaseId,
            scopes,
            tokenType: refreshedToken.tokenType,
        });

        if (completionResult.isOk()) {
            if (completionResult.value.status === 'stale') {
                return readRefreshWinner(input);
            }

            return ok({
                accessToken: refreshedToken.accessToken,
                accessTokenExpiresAt: completionResult.value.tokenSet.accessTokenExpiresAt,
                scopes: completionResult.value.tokenSet.scopes,
            });
        }

        if (attempt === 0) {
            await wait(repositoryRetryDelayMs);
        }
    }

    return err('database-error');
}

async function invalidateTerminalRefreshCredential(
    input: ClaimedRefresh
): Promise<Result<FluxerCredential, AuthenticatedFluxerContextError>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const invalidationResult = await invalidateFluxerOAuthTokenSet(input.db, {
            expectedGeneration: input.tokenSet.credentialGeneration,
            fluxerUserId: input.fluxerUserId,
            leaseId: input.leaseId,
        });

        if (invalidationResult.isOk()) {
            return invalidationResult.value.status === 'stale' ? readRefreshWinner(input) : err('token-refresh-failed');
        }

        if (attempt === 0) {
            await wait(repositoryRetryDelayMs);
        }
    }

    return err('database-error');
}

async function recordRefreshFailure(input: ClaimedRefresh, cooldownMs: number): Promise<void> {
    await recordFluxerOAuthTokenRefreshFailure(input.db, {
        cooldownMs,
        expectedGeneration: input.tokenSet.credentialGeneration,
        fluxerUserId: input.fluxerUserId,
        leaseId: input.leaseId,
    });
}

async function waitForRefreshWinner(
    input: RefreshInput,
    retryAt: Date
): Promise<Result<FluxerCredential, AuthenticatedFluxerContextError>> {
    const deadlineMs = Math.min(retryAt.getTime(), Date.now() + refreshLeaseDurationMs);
    let delayMs = 0;

    while (Date.now() <= deadlineMs) {
        if (delayMs > 0) await wait(Math.min(delayMs, Math.max(0, deadlineMs - Date.now())));
        const winnerResult = await findUsableFluxerOAuthTokenSetByUserId(input.db, {
            fluxerUserId: input.fluxerUserId,
        });

        if (winnerResult.isErr()) {
            return err(mapRefreshWinnerRepositoryError(winnerResult.error));
        }

        if (winnerResult.value.credentialGeneration !== input.tokenSet.credentialGeneration) {
            return readRefreshWinnerFromTokenSet(winnerResult.value, input.tokenEncryptionKey);
        }

        if (Date.now() >= deadlineMs) break;
        delayMs = delayMs === 0 ? repositoryRetryDelayMs : Math.min(delayMs * 2, refreshWinnerMaximumPollDelayMs);
    }

    return err('token-refresh-failed');
}

async function readRefreshWinner(
    input: RefreshInput
): Promise<Result<FluxerCredential, AuthenticatedFluxerContextError>> {
    const winnerResult = await findUsableFluxerOAuthTokenSetByUserId(input.db, {
        fluxerUserId: input.fluxerUserId,
    });

    if (winnerResult.isErr()) {
        return err(mapRefreshWinnerRepositoryError(winnerResult.error));
    }

    return readRefreshWinnerFromTokenSet(winnerResult.value, input.tokenEncryptionKey);
}

function readRefreshWinnerFromTokenSet(
    tokenSet: FluxerOAuthTokenRecord,
    tokenEncryptionKey: string
): Result<FluxerCredential, AuthenticatedFluxerContextError> {
    const credentialResult = readStoredFluxerCredential(tokenSet, tokenEncryptionKey, Date.now());

    return credentialResult.isErr() && credentialResult.error === 'token-expired'
        ? err('token-refresh-failed')
        : credentialResult;
}

function readStoredFluxerCredential(
    tokenSet: FluxerOAuthTokenRecord,
    tokenEncryptionKey: string,
    nowMs: number
): Result<FluxerCredential, AuthenticatedFluxerContextError> {
    if (shouldRefreshAccessToken(tokenSet, nowMs)) {
        return err('token-expired');
    }

    const accessTokenResult = decryptFluxerToken({
        encryptedToken: toEncryptedFluxerToken(tokenSet.accessToken),
        encryptionKey: tokenEncryptionKey,
    });

    if (accessTokenResult.isErr()) {
        return err(mapFluxerTokenCryptoError(accessTokenResult.error));
    }

    return ok({
        accessToken: accessTokenResult.value,
        accessTokenExpiresAt: tokenSet.accessTokenExpiresAt,
        scopes: tokenSet.scopes,
    });
}

function encryptRefreshedTokens(
    token: FluxerOAuthTokenResponse,
    tokenEncryptionKey: string
): Result<
    { accessToken: EncryptedOAuthTokenPayload; refreshToken: EncryptedOAuthTokenPayload },
    AuthenticatedFluxerContextError
> {
    const accessTokenResult = encryptFluxerToken({ token: token.accessToken, encryptionKey: tokenEncryptionKey });

    if (accessTokenResult.isErr()) {
        return err(mapFluxerTokenCryptoError(accessTokenResult.error));
    }

    const refreshTokenResult = encryptFluxerToken({ token: token.refreshToken, encryptionKey: tokenEncryptionKey });

    if (refreshTokenResult.isErr()) {
        return err(mapFluxerTokenCryptoError(refreshTokenResult.error));
    }

    return ok({ accessToken: accessTokenResult.value, refreshToken: refreshTokenResult.value });
}

function shouldRefreshAccessToken(tokenSet: FluxerOAuthTokenRecord, nowMs: number): boolean {
    return tokenSet.accessTokenExpiresAt.getTime() <= nowMs + accessTokenRefreshSkewMs;
}

function readRefreshFailureCooldownMs(error: FluxerOAuthTokenRefreshError): number {
    const retryAfterMs = error.type === 'transient-response' ? (error.retryAfterMs ?? 0) : 0;

    return Math.min(Math.max(refreshFailureCooldownMs, retryAfterMs), refreshFailureMaximumCooldownMs);
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

function mapRefreshWinnerRepositoryError(error: FluxerOAuthTokenRepositoryError): AuthenticatedFluxerContextError {
    return error === 'database-error' ? 'database-error' : 'token-refresh-failed';
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

function wait(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    });
}
