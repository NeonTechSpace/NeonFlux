import type { ConvexConfig, RuntimeConfig } from '@neonflux/config/env';

import {
    createConvexServiceDb,
    type ConvexDbServiceName,
    type ConvexServiceDbClient,
    type ConvexServiceRuntimeConfig,
} from './convex.js';

export type RuntimeDbClient = ConvexServiceDbClient;

export async function createRuntimeDb(
    config: RuntimeConfig,
    options: { serviceName: ConvexDbServiceName }
): Promise<RuntimeDbClient> {
    const serviceConfig = readConvexServiceRuntimeConfig(config.convex, options.serviceName);

    if (serviceConfig) return createConvexServiceDb(serviceConfig, { serviceName: options.serviceName });

    throw new Error('Complete Convex config is required');
}

export function readConvexServiceRuntimeConfig(
    config: ConvexConfig | undefined,
    serviceName: ConvexDbServiceName
): ConvexServiceRuntimeConfig | undefined {
    if (!config?.deployment || !config.publicUrl || !config.url) return undefined;

    const audience = serviceName === 'bot' ? config.botAuthJwtAudience : config.webAuthJwtAudience;
    const issuer = serviceName === 'bot' ? config.botAuthJwtIssuer : config.webAuthJwtIssuer;
    const privateKey = serviceName === 'bot' ? config.botAuthJwtPrivateKey : config.webAuthJwtPrivateKey;

    if (!audience || !issuer || !privateKey) return undefined;

    return {
        authJwtAudience: audience,
        authJwtIssuer: issuer,
        authJwtPrivateKey: privateKey,
        deployment: config.deployment,
        publicUrl: config.publicUrl,
        url: config.url,
    };
}

export function isConvexRuntimeDb(client: RuntimeDbClient): client is ConvexServiceDbClient {
    void client;
    return true;
}
