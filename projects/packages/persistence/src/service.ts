import type { ConvexConfig, RequiredConvexConfig, RuntimeConfig } from '@neonflux/config/env';

import {
    createConvexServicePersistence,
    type ConvexPersistenceServiceName,
    type ConvexServicePersistenceClient,
} from './convex.js';

export type RuntimePersistenceClient = ConvexServicePersistenceClient;

export async function createRuntimePersistence(
    config: RuntimeConfig,
    options: { serviceName: ConvexPersistenceServiceName }
): Promise<RuntimePersistenceClient> {
    if (isRequiredConvexConfig(config.convex)) {
        return createConvexServicePersistence(config.convex, {
            serviceName: options.serviceName,
        });
    }

    throw new Error('Complete Convex config is required');
}

export function isRequiredConvexConfig(
    config: ConvexConfig | undefined
): config is RequiredConvexConfig {
    return Boolean(
        config?.authJwtAudience &&
        config.authJwtIssuer &&
        config.authJwtPrivateKey &&
        config.deployKey &&
        config.deployment &&
        config.publicUrl &&
        config.url
    );
}

export function isConvexRuntimePersistence(client: RuntimePersistenceClient): client is ConvexServicePersistenceClient {
    return 'kind' in client.db && client.db.kind === 'convex';
}
