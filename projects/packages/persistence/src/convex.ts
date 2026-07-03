import type { RequiredConvexConfig } from '@neonflux/config/env';
import { createNeonFluxConvexHttpClient } from '@neonflux/convex/client';
import { signNeonFluxServiceJwt } from '@neonflux/convex/jwt';

export type ConvexPersistenceServiceName = 'bot' | 'migration' | 'web';

export type ConvexServicePersistenceOptions = {
    expiresInSeconds?: number;
    now?: Date;
    serviceName: ConvexPersistenceServiceName;
};

export type ConvexServicePersistenceClient = {
    close(): Promise<void>;
    client: ReturnType<typeof createNeonFluxConvexHttpClient>;
    db: ConvexPersistenceDatabase;
    deployment: string;
    serviceName: ConvexPersistenceServiceName;
    url: string;
};

export type ConvexPersistenceDatabase = {
    client: ReturnType<typeof createNeonFluxConvexHttpClient>;
    kind: 'convex';
    serviceName: ConvexPersistenceServiceName;
};

export async function createConvexServiceAuthToken(
    config: RequiredConvexConfig,
    options: ConvexServicePersistenceOptions
): Promise<string> {
    return signNeonFluxServiceJwt(
        {
            audience: config.authJwtAudience,
            issuer: config.authJwtIssuer,
            privateKeyPem: config.authJwtPrivateKey,
        },
        {
            ...(options.expiresInSeconds ? { expiresInSeconds: options.expiresInSeconds } : {}),
            ...(options.now ? { now: options.now } : {}),
            serviceName: options.serviceName,
        }
    );
}

export async function createConvexServicePersistence(
    config: RequiredConvexConfig,
    options: ConvexServicePersistenceOptions
): Promise<ConvexServicePersistenceClient> {
    const authToken = await createConvexServiceAuthToken(config, options);
    const client = createNeonFluxConvexHttpClient({
        authToken,
        url: config.url,
    });

    return {
        async close() {
            await Promise.resolve();
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
    };
}

export function isConvexPersistenceDatabase(value: unknown): value is ConvexPersistenceDatabase {
    return (
        typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'convex' && 'client' in value
    );
}
