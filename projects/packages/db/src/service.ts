import type { ConvexConfig, RequiredConvexConfig, RuntimeConfig } from '@neonflux/config/env';

import { createConvexServiceDb, type ConvexDbServiceName, type ConvexServiceDbClient } from './convex.js';

export type RuntimeDbClient = ConvexServiceDbClient;

export async function createRuntimeDb(
    config: RuntimeConfig,
    options: { serviceName: ConvexDbServiceName }
): Promise<RuntimeDbClient> {
    if (isRequiredConvexConfig(config.convex)) {
        return createConvexServiceDb(config.convex, {
            serviceName: options.serviceName,
        });
    }

    throw new Error('Complete Convex config is required');
}

export function isRequiredConvexConfig(config: ConvexConfig | undefined): config is RequiredConvexConfig {
    return Boolean(
        config?.authJwtAudience &&
        config.authJwtIssuer &&
        config.authJwtJwks &&
        config.authJwtPrivateKey &&
        config.deployment &&
        config.publicUrl &&
        config.url
    );
}

export function isConvexRuntimeDb(client: RuntimeDbClient): client is ConvexServiceDbClient {
    return 'kind' in client.db && client.db.kind === 'convex';
}
