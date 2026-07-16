import { signNeonFluxServiceJwt } from './jwt.js';

export type NeonFluxServiceAuthTokenProvider = () => Promise<string>;

export type NeonFluxServiceAuthTokenProviderConfig = {
    audience: string;
    expiresInSeconds: number;
    issuer: string;
    privateKey: string;
    refreshSkewSeconds: number;
    serviceName: 'bot' | 'web';
    signingRetryDelayMs: number;
};

type CachedServiceAuthToken = {
    refreshAtMs: number;
    value: string;
};

type ServiceAuthSigningFailure = {
    error: NeonFluxServiceAuthTokenRefreshError;
    retryAtMs: number;
};

export class NeonFluxServiceAuthTokenRefreshError extends Error {
    constructor(serviceName: 'bot' | 'web') {
        super(`NeonFlux ${serviceName} service authentication token refresh failed.`);
        this.name = 'NeonFluxServiceAuthTokenRefreshError';
    }
}

export function createNeonFluxServiceAuthTokenProvider(
    config: NeonFluxServiceAuthTokenProviderConfig
): NeonFluxServiceAuthTokenProvider {
    assertProviderConfig(config);

    let cachedToken: CachedServiceAuthToken | undefined;
    let refreshPromise: Promise<string> | undefined;
    let signingFailure: ServiceAuthSigningFailure | undefined;

    return function provideNeonFluxServiceAuthToken(): Promise<string> {
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
        const refreshAtMs = issuedAtMs + (config.expiresInSeconds - config.refreshSkewSeconds) * 1_000;
        const refresh = signNeonFluxServiceJwt(
            {
                audience: config.audience,
                issuer: config.issuer,
                privateKeyPem: config.privateKey,
            },
            {
                expiresInSeconds: config.expiresInSeconds,
                now: new Date(issuedAtMs),
                serviceName: config.serviceName,
            }
        )
            .then((token) => {
                if (Date.now() >= refreshAtMs) {
                    throw new Error('The signed service authentication token is already stale.');
                }

                cachedToken = {
                    refreshAtMs,
                    value: token,
                };

                return token;
            })
            .catch(() => {
                // Signer/parser details can contain key material, so callers receive only a stable error.
                const error = new NeonFluxServiceAuthTokenRefreshError(config.serviceName);

                signingFailure = {
                    error,
                    retryAtMs: Date.now() + config.signingRetryDelayMs,
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

function assertProviderConfig(config: NeonFluxServiceAuthTokenProviderConfig): void {
    if (!config.audience.trim()) throw new Error('Service authentication token audience is required.');
    if (!config.issuer.trim()) throw new Error('Service authentication token issuer is required.');
    if (!config.privateKey.trim()) throw new Error('Service authentication token private key is required.');
    if (!Number.isSafeInteger(config.expiresInSeconds) || config.expiresInSeconds < 2) {
        throw new RangeError('Service authentication token lifetime must be an integer of at least 2 seconds.');
    }
    if (
        !Number.isSafeInteger(config.refreshSkewSeconds) ||
        config.refreshSkewSeconds < 1 ||
        config.refreshSkewSeconds >= config.expiresInSeconds
    ) {
        throw new RangeError(
            'Service authentication token refresh skew must be a positive integer below its lifetime.'
        );
    }
    if (!Number.isSafeInteger(config.signingRetryDelayMs) || config.signingRetryDelayMs < 0) {
        throw new RangeError('Service authentication token signing retry delay must be a non-negative integer.');
    }
}
