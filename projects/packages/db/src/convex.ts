import { createNeonFluxConvexHttpClient } from '@neonflux/convex/client';
import { signNeonFluxServiceJwt } from '@neonflux/convex/jwt';

export const CONVEX_SERVICE_AUTH_TOKEN_LIFETIME_SECONDS = 10 * 60;
export const CONVEX_SERVICE_AUTH_REFRESH_SKEW_SECONDS = 60;
export const CONVEX_SERVICE_AUTH_SIGNING_RETRY_DELAY_MS = 5_000;

export type ConvexDbServiceName = 'bot' | 'web';

export type ConvexServiceRuntimeConfig = {
    authJwtAudience: string;
    authJwtIssuer: string;
    authJwtPrivateKey: string;
    deployment: string;
    publicUrl: string;
    url: string;
};

export type ConvexServiceDbOptions = {
    expiresInSeconds?: number;
    serviceName: ConvexDbServiceName;
};

export type ConvexServiceAuthTokenProvider = () => Promise<string>;

export type ConvexServiceDbClient = {
    close(): Promise<void>;
    client: ReturnType<typeof createNeonFluxConvexHttpClient>;
    db: ConvexDatabase;
    deployment: string;
    serviceName: ConvexDbServiceName;
    url: string;
};

export type ConvexDatabase = {
    client: ReturnType<typeof createNeonFluxConvexHttpClient>;
    kind: 'convex';
    serviceName: ConvexDbServiceName;
};

type CachedConvexServiceAuthToken = {
    refreshAtMs: number;
    value: string;
};

type ConvexServiceAuthSigningFailure = {
    error: ConvexServiceAuthTokenRefreshError;
    retryAtMs: number;
};

export class ConvexServiceAuthTokenRefreshError extends Error {
    constructor(serviceName: ConvexDbServiceName) {
        super(`Convex ${serviceName} service authentication token refresh failed.`);
        this.name = 'ConvexServiceAuthTokenRefreshError';
    }
}

export function createConvexServiceAuthToken(
    config: ConvexServiceRuntimeConfig,
    options: ConvexServiceDbOptions
): Promise<string> {
    const expiresInSeconds = readServiceAuthTokenLifetimeSeconds(options.expiresInSeconds);

    return signConvexServiceAuthToken(config, options.serviceName, expiresInSeconds, new Date());
}

export function createConvexServiceAuthTokenProvider(
    config: ConvexServiceRuntimeConfig,
    options: ConvexServiceDbOptions
): ConvexServiceAuthTokenProvider {
    const expiresInSeconds = readServiceAuthTokenLifetimeSeconds(options.expiresInSeconds);
    const serviceName = options.serviceName;
    const refreshSkewSeconds = Math.min(CONVEX_SERVICE_AUTH_REFRESH_SKEW_SECONDS, Math.floor(expiresInSeconds / 2));
    let cachedToken: CachedConvexServiceAuthToken | undefined;
    let refreshPromise: Promise<string> | undefined;
    let signingFailure: ConvexServiceAuthSigningFailure | undefined;

    return function provideConvexServiceAuthToken(): Promise<string> {
        const requestTimeMs = Date.now();

        if (cachedToken && requestTimeMs < cachedToken.refreshAtMs) {
            return Promise.resolve(cachedToken.value);
        }

        cachedToken = undefined;

        if (refreshPromise) {
            return refreshPromise;
        }

        if (signingFailure && requestTimeMs < signingFailure.retryAtMs) {
            return Promise.reject(signingFailure.error);
        }

        signingFailure = undefined;

        const issuedAtMs = Math.floor(requestTimeMs / 1_000) * 1_000;
        const refreshAtMs = issuedAtMs + (expiresInSeconds - refreshSkewSeconds) * 1_000;
        const refresh = signConvexServiceAuthToken(config, serviceName, expiresInSeconds, new Date(issuedAtMs))
            .then((token) => {
                if (Date.now() >= refreshAtMs) {
                    throw new Error('The signed Convex service authentication token is already stale.');
                }

                cachedToken = {
                    refreshAtMs,
                    value: token,
                };

                return token;
            })
            .catch(() => {
                // Keep signer/parser details out of surfaced errors because they may contain key material.
                const error = new ConvexServiceAuthTokenRefreshError(serviceName);

                signingFailure = {
                    error,
                    retryAtMs: Date.now() + CONVEX_SERVICE_AUTH_SIGNING_RETRY_DELAY_MS,
                };

                throw error;
            });

        refreshPromise = refresh;

        const clearRefreshPromise = () => {
            if (refreshPromise === refresh) {
                refreshPromise = undefined;
            }
        };

        void refresh.then(clearRefreshPromise, clearRefreshPromise);

        return refresh;
    };
}

function signConvexServiceAuthToken(
    config: ConvexServiceRuntimeConfig,
    serviceName: ConvexDbServiceName,
    expiresInSeconds: number,
    now: Date
): Promise<string> {
    return signNeonFluxServiceJwt(
        {
            audience: config.authJwtAudience,
            issuer: config.authJwtIssuer,
            privateKeyPem: config.authJwtPrivateKey,
        },
        {
            expiresInSeconds,
            now,
            serviceName,
        }
    );
}

function readServiceAuthTokenLifetimeSeconds(value: number | undefined): number {
    const lifetime = value ?? CONVEX_SERVICE_AUTH_TOKEN_LIFETIME_SECONDS;

    if (!Number.isSafeInteger(lifetime) || lifetime < 2) {
        throw new RangeError('Convex service authentication token lifetime must be an integer of at least 2 seconds.');
    }

    return lifetime;
}

export function createConvexServiceDb(
    config: ConvexServiceRuntimeConfig,
    options: ConvexServiceDbOptions
): Promise<ConvexServiceDbClient> {
    const authTokenProvider = createConvexServiceAuthTokenProvider(config, options);
    const client = createNeonFluxConvexHttpClient({
        authTokenProvider,
        url: config.url,
    });

    return Promise.resolve({
        close() {
            return Promise.resolve();
        },
        client,
        db: {
            client,
            kind: 'convex',
            serviceName: options.serviceName,
        },
        deployment: config.deployment,
        serviceName: options.serviceName,
        url: config.url,
    });
}
