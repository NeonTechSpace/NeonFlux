import type { RequiredConvexConfig } from '@neonflux/config/env';
import { createNeonFluxConvexHttpClient } from '@neonflux/convex/client';
import { signNeonFluxServiceJwt } from '@neonflux/convex/jwt';

export type ConvexDbServiceName = 'bot' | 'web';

export type ConvexServiceDbOptions = {
    expiresInSeconds?: number;
    now?: Date;
    serviceName: ConvexDbServiceName;
};

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

export async function createConvexServiceAuthToken(
    config: RequiredConvexConfig,
    options: ConvexServiceDbOptions
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

export async function createConvexServiceDb(
    config: RequiredConvexConfig,
    options: ConvexServiceDbOptions
): Promise<ConvexServiceDbClient> {
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
