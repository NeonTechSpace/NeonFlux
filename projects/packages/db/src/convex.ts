import { createNeonFluxConvexHttpClient } from '@neonflux/convex/client';
import { signNeonFluxServiceJwt } from '@neonflux/convex/jwt';
import {
    createNeonFluxServiceAuthTokenProvider,
    NeonFluxServiceAuthTokenRefreshError,
} from '@neonflux/convex/service-auth-token';

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

export { NeonFluxServiceAuthTokenRefreshError as ConvexServiceAuthTokenRefreshError };

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
    const refreshSkewSeconds = Math.min(CONVEX_SERVICE_AUTH_REFRESH_SKEW_SECONDS, Math.floor(expiresInSeconds / 2));

    const providerConfig = {
        get audience() {
            return config.authJwtAudience;
        },
        expiresInSeconds,
        get issuer() {
            return config.authJwtIssuer;
        },
        get privateKey() {
            return config.authJwtPrivateKey;
        },
        refreshSkewSeconds,
        serviceName: options.serviceName,
        signingRetryDelayMs: CONVEX_SERVICE_AUTH_SIGNING_RETRY_DELAY_MS,
    };

    return createNeonFluxServiceAuthTokenProvider(providerConfig);
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
