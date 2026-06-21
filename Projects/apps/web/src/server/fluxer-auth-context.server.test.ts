import { Buffer } from 'node:buffer';

import {
    findUsableFluxerOAuthTokenSetByUserId,
    invalidateFluxerOAuthTokenSet,
    upsertFluxerOAuthTokenSet,
} from '@neonflux/db';
import type { FluxerOAuthTokenRecord, WebSessionRecord } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { refreshFluxerOAuthToken } from '@neonflux/fluxer/oauth';
import type * as NeonFluxerOAuth from '@neonflux/fluxer/oauth';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptFluxerToken, encryptFluxerToken } from './fluxer-token-crypto.js';
import type { EncryptedFluxerToken } from './fluxer-token-crypto.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';
import { readAuthenticatedWebSession } from './web-session.server.js';

const request = new Request('http://localhost:3000/dashboard');
const tokenEncryptionKey = Buffer.alloc(32, 1).toString('base64url');
const otherTokenEncryptionKey = Buffer.alloc(32, 2).toString('base64url');
const accessToken = 'fluxer-access-token';
const refreshToken = 'fluxer-refresh-token';
const refreshedAccessToken = 'refreshed-fluxer-access-token';
const refreshedRefreshToken = 'refreshed-fluxer-refresh-token';
const activeSession = {
    id: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG',
    fluxerUserId: '1517169145576165376',
    createdAt: new Date('2026-06-21T00:00:00.000Z'),
    expiresAt: new Date('2026-06-28T00:00:00.000Z'),
    revokedAt: null,
} satisfies WebSessionRecord;
const futureAccessTokenExpiresAt = new Date('2026-06-21T01:00:00.000Z');
const expiredAccessTokenExpiresAt = new Date('2026-06-20T23:59:59.999Z');
const refreshedAccessTokenExpiresAt = new Date('2026-06-21T02:00:00.000Z');

vi.mock('./database.server.js', () => ({
    getWebDatabaseClient: () => ({
        db: {},
    }),
}));

vi.mock('./web-session.server.js', () => ({
    readAuthenticatedWebSession: vi.fn(),
}));

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        findUsableFluxerOAuthTokenSetByUserId: vi.fn(),
        invalidateFluxerOAuthTokenSet: vi.fn(),
        upsertFluxerOAuthTokenSet: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer/oauth', async (importActual) => {
    const actual = await importActual<typeof NeonFluxerOAuth>();

    return {
        ...actual,
        refreshFluxerOAuthToken: vi.fn(),
    };
});

describe('readAuthenticatedFluxerContext', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-21T00:00:00.000Z'));
        stubTokenEnv();
        vi.mocked(readAuthenticatedWebSession).mockResolvedValue(ok(activeSession));
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValue(ok(createTokenSet()));
        vi.mocked(refreshFluxerOAuthToken).mockResolvedValue(ok(createRefreshResponse()));
        vi.mocked(upsertFluxerOAuthTokenSet).mockImplementation((_db, input) =>
            Promise.resolve(
                ok(
                    createTokenSet({
                        fluxerUserId: input.fluxerUserId,
                        accessToken: input.accessToken,
                        refreshToken: input.refreshToken ?? null,
                        tokenType: input.tokenType,
                        accessTokenExpiresAt: input.accessTokenExpiresAt,
                        scopes: [...input.scopes],
                    })
                )
            )
        );
        vi.mocked(invalidateFluxerOAuthTokenSet).mockResolvedValue(
            ok(
                createTokenSet({
                    invalidatedAt: new Date('2026-06-21T00:00:00.000Z'),
                })
            )
        );
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('returns decrypted Fluxer access token context for a valid session and usable token set', async () => {
        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            session: activeSession,
            fluxerUserId: activeSession.fluxerUserId,
            accessToken,
            scopes: ['identify', 'guilds'],
            accessTokenExpiresAt: futureAccessTokenExpiresAt,
        });
    });

    it('queries token storage with the authenticated session Fluxer user id', async () => {
        await readAuthenticatedFluxerContext(request);

        expect(findUsableFluxerOAuthTokenSetByUserId).toHaveBeenCalledWith(
            {},
            {
                fluxerUserId: activeSession.fluxerUserId,
            }
        );
    });

    it('does not refresh or persist tokens when the stored access token is still active', async () => {
        await readAuthenticatedFluxerContext(request);

        expect(refreshFluxerOAuthToken).not.toHaveBeenCalled();
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(invalidateFluxerOAuthTokenSet).not.toHaveBeenCalled();
    });

    it('refreshes an expired token set and returns refreshed Fluxer access token context', async () => {
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(
                createTokenSet({
                    accessTokenExpiresAt: expiredAccessTokenExpiresAt,
                    refreshToken: createEncryptedRefreshToken(),
                })
            )
        );

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            session: activeSession,
            fluxerUserId: activeSession.fluxerUserId,
            accessToken: refreshedAccessToken,
            scopes: ['identify', 'guilds'],
            accessTokenExpiresAt: refreshedAccessTokenExpiresAt,
        });
        expect(refreshFluxerOAuthToken).toHaveBeenCalledWith({
            appId: 'fluxer-app-id',
            clientSecret: 'fluxer-client-secret',
            refreshToken,
        });
        expect(upsertFluxerOAuthTokenSet).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                fluxerUserId: activeSession.fluxerUserId,
                tokenType: 'Bearer',
                accessTokenExpiresAt: refreshedAccessTokenExpiresAt,
                scopes: ['identify', 'guilds'],
            })
        );
        expect(invalidateFluxerOAuthTokenSet).not.toHaveBeenCalled();
    });

    it('encrypts refreshed token data before persisting it', async () => {
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(
                createTokenSet({
                    accessTokenExpiresAt: expiredAccessTokenExpiresAt,
                    refreshToken: createEncryptedRefreshToken(),
                })
            )
        );

        await readAuthenticatedFluxerContext(request);

        const persistedInput = getPersistedTokenInput();
        const persistedJson = JSON.stringify({
            accessToken: persistedInput.accessToken,
            refreshToken: persistedInput.refreshToken,
        });

        expect(persistedJson).not.toContain(refreshedAccessToken);
        expect(persistedJson).not.toContain(refreshedRefreshToken);

        const decryptedAccessTokenResult = decryptFluxerToken({
            encryptedToken: persistedInput.accessToken as EncryptedFluxerToken,
            encryptionKey: tokenEncryptionKey,
        });
        const decryptedRefreshTokenResult = decryptFluxerToken({
            encryptedToken: persistedInput.refreshToken as EncryptedFluxerToken,
            encryptionKey: tokenEncryptionKey,
        });

        expect(decryptedAccessTokenResult.isOk()).toBe(true);
        expect(decryptedAccessTokenResult._unsafeUnwrap()).toBe(refreshedAccessToken);
        expect(decryptedRefreshTokenResult.isOk()).toBe(true);
        expect(decryptedRefreshTokenResult._unsafeUnwrap()).toBe(refreshedRefreshToken);
    });

    it('returns missing-refresh-token when an expired token set has no stored refresh token', async () => {
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(createTokenSet({ accessTokenExpiresAt: expiredAccessTokenExpiresAt }))
        );

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-refresh-token');
        expect(refreshFluxerOAuthToken).not.toHaveBeenCalled();
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
    });

    it('passes through missing session errors and does not query token storage', async () => {
        vi.mocked(readAuthenticatedWebSession).mockResolvedValueOnce(err('missing-cookie'));

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-cookie');
        expect(findUsableFluxerOAuthTokenSetByUserId).not.toHaveBeenCalled();
    });

    it('returns missing-token-set when token storage has no usable token set', async () => {
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(err('not-found'));

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-token-set');
    });

    it('returns database-error when token storage fails', async () => {
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(err('database-error'));

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });

    it('throws clearly when FLUXER_TOKEN_ENCRYPTION_KEY is missing', async () => {
        vi.stubEnv('FLUXER_TOKEN_ENCRYPTION_KEY', '');

        await expect(readAuthenticatedFluxerContext(request)).rejects.toThrow(
            'FLUXER_TOKEN_ENCRYPTION_KEY is required'
        );
        expect(findUsableFluxerOAuthTokenSetByUserId).not.toHaveBeenCalled();
    });

    it('returns invalid-token-payload when the stored access token payload is invalid', async () => {
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(
                createTokenSet({
                    accessToken: {
                        ...createEncryptedAccessToken(),
                        version: 'v2',
                    },
                })
            )
        );

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-token-payload');
    });

    it('returns invalid-token-payload when the stored refresh token payload is invalid', async () => {
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(
                createTokenSet({
                    accessTokenExpiresAt: expiredAccessTokenExpiresAt,
                    refreshToken: {
                        ...createEncryptedRefreshToken(),
                        version: 'v2',
                    },
                })
            )
        );

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-token-payload');
        expect(refreshFluxerOAuthToken).not.toHaveBeenCalled();
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
    });

    it('returns decrypt-failed when a different valid encryption key is configured', async () => {
        vi.stubEnv('FLUXER_TOKEN_ENCRYPTION_KEY', otherTokenEncryptionKey);

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('decrypt-failed');
    });

    it('returns decrypt-failed when the stored access token auth tag is tampered with', async () => {
        const encryptedToken = createEncryptedAccessToken();

        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(
                createTokenSet({
                    accessToken: {
                        ...encryptedToken,
                        authTag: tamperBase64UrlBytes(encryptedToken.authTag),
                    },
                })
            )
        );

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('decrypt-failed');
    });

    it('returns decrypt-failed when the stored refresh token auth tag is tampered with', async () => {
        const encryptedRefreshToken = createEncryptedRefreshToken();

        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(
                createTokenSet({
                    accessTokenExpiresAt: expiredAccessTokenExpiresAt,
                    refreshToken: {
                        ...encryptedRefreshToken,
                        authTag: tamperBase64UrlBytes(encryptedRefreshToken.authTag),
                    },
                })
            )
        );

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('decrypt-failed');
        expect(refreshFluxerOAuthToken).not.toHaveBeenCalled();
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
    });

    it('invalidates the token set when Fluxer rejects token refresh', async () => {
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(
                createTokenSet({
                    accessTokenExpiresAt: expiredAccessTokenExpiresAt,
                    refreshToken: createEncryptedRefreshToken(),
                })
            )
        );
        vi.mocked(refreshFluxerOAuthToken).mockResolvedValueOnce(
            err({ type: 'request-failed', status: 401, statusText: 'Unauthorized' })
        );

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('token-refresh-failed');
        expect(invalidateFluxerOAuthTokenSet).toHaveBeenCalledWith(
            {},
            {
                fluxerUserId: activeSession.fluxerUserId,
            }
        );
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
    });

    it('returns database-error when token invalidation fails after Fluxer rejects refresh', async () => {
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(
                createTokenSet({
                    accessTokenExpiresAt: expiredAccessTokenExpiresAt,
                    refreshToken: createEncryptedRefreshToken(),
                })
            )
        );
        vi.mocked(refreshFluxerOAuthToken).mockResolvedValueOnce(
            err({ type: 'request-failed', status: 401, statusText: 'Unauthorized' })
        );
        vi.mocked(invalidateFluxerOAuthTokenSet).mockResolvedValueOnce(err('database-error'));

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
    });

    it('returns token-refresh-failed without invalidating when refresh has a network failure', async () => {
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(
                createTokenSet({
                    accessTokenExpiresAt: expiredAccessTokenExpiresAt,
                    refreshToken: createEncryptedRefreshToken(),
                })
            )
        );
        vi.mocked(refreshFluxerOAuthToken).mockResolvedValueOnce(
            err({ type: 'network-error', error: new Error('Network unavailable.') })
        );

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('token-refresh-failed');
        expect(invalidateFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
    });

    it('returns token-refresh-failed without invalidating when refresh returns malformed token data', async () => {
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(
                createTokenSet({
                    accessTokenExpiresAt: expiredAccessTokenExpiresAt,
                    refreshToken: createEncryptedRefreshToken(),
                })
            )
        );
        vi.mocked(refreshFluxerOAuthToken).mockResolvedValueOnce(err({ type: 'invalid-response' }));

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('token-refresh-failed');
        expect(invalidateFluxerOAuthTokenSet).not.toHaveBeenCalled();
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
    });

    it('returns database-error when refreshed token persistence fails', async () => {
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(
                createTokenSet({
                    accessTokenExpiresAt: expiredAccessTokenExpiresAt,
                    refreshToken: createEncryptedRefreshToken(),
                })
            )
        );
        vi.mocked(upsertFluxerOAuthTokenSet).mockResolvedValueOnce(err('database-error'));

        const result = await readAuthenticatedFluxerContext(request);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
        expect(invalidateFluxerOAuthTokenSet).not.toHaveBeenCalled();
    });

    it('throws clearly when FLUXER_APP_ID is missing for refresh', async () => {
        vi.stubEnv('FLUXER_APP_ID', '');
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(
                createTokenSet({
                    accessTokenExpiresAt: expiredAccessTokenExpiresAt,
                    refreshToken: createEncryptedRefreshToken(),
                })
            )
        );

        await expect(readAuthenticatedFluxerContext(request)).rejects.toThrow('FLUXER_APP_ID is required');
        expect(refreshFluxerOAuthToken).not.toHaveBeenCalled();
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
    });

    it('throws clearly when FLUXER_CLIENT_SECRET is missing for refresh', async () => {
        vi.stubEnv('FLUXER_CLIENT_SECRET', '');
        vi.mocked(findUsableFluxerOAuthTokenSetByUserId).mockResolvedValueOnce(
            ok(
                createTokenSet({
                    accessTokenExpiresAt: expiredAccessTokenExpiresAt,
                    refreshToken: createEncryptedRefreshToken(),
                })
            )
        );

        await expect(readAuthenticatedFluxerContext(request)).rejects.toThrow('FLUXER_CLIENT_SECRET is required');
        expect(refreshFluxerOAuthToken).not.toHaveBeenCalled();
        expect(upsertFluxerOAuthTokenSet).not.toHaveBeenCalled();
    });
});

function stubTokenEnv(): void {
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('INSTANCE_MODE', 'multi');
    vi.stubEnv('FLUXER_TOKEN_ENCRYPTION_KEY', tokenEncryptionKey);
    vi.stubEnv('FLUXER_APP_ID', 'fluxer-app-id');
    vi.stubEnv('FLUXER_CLIENT_SECRET', 'fluxer-client-secret');
}

function createTokenSet(overrides: Partial<FluxerOAuthTokenRecord> = {}): FluxerOAuthTokenRecord {
    return {
        fluxerUserId: activeSession.fluxerUserId,
        accessToken: createEncryptedAccessToken(),
        refreshToken: null,
        tokenType: 'Bearer',
        accessTokenExpiresAt: futureAccessTokenExpiresAt,
        scopes: ['identify', 'guilds'],
        invalidatedAt: null,
        createdAt: new Date('2026-06-21T00:00:00.000Z'),
        updatedAt: new Date('2026-06-21T00:00:00.000Z'),
        ...overrides,
    };
}

function createRefreshResponse() {
    return {
        accessToken: refreshedAccessToken,
        tokenType: 'Bearer',
        expiresIn: 7200,
        refreshToken: refreshedRefreshToken,
        scope: 'identify guilds',
    };
}

function createEncryptedAccessToken(): EncryptedFluxerToken {
    const result = encryptFluxerToken({
        token: accessToken,
        encryptionKey: tokenEncryptionKey,
    });

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

function createEncryptedRefreshToken(): EncryptedFluxerToken {
    const result = encryptFluxerToken({
        token: refreshToken,
        encryptionKey: tokenEncryptionKey,
    });

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

function getPersistedTokenInput(): Parameters<typeof upsertFluxerOAuthTokenSet>[1] {
    expect(upsertFluxerOAuthTokenSet).toHaveBeenCalled();

    const call = vi.mocked(upsertFluxerOAuthTokenSet).mock.calls[0];

    return call[1];
}

function tamperBase64UrlBytes(value: string): string {
    const decodedValue = Buffer.from(value, 'base64url');
    decodedValue[0] ^= 1;

    return decodedValue.toString('base64url');
}
